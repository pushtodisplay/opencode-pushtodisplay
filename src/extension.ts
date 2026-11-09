/**
 * Push To Display plugin for OpenCode.
 *
 * Mirrors agent activity onto a Push To Display board. One panel is a *shared*
 * scrolling log: every entry is its own message, newest at the top, and any
 * agent may write to any panel.
 *
 *   opencode-pushtodisplay session closed ENDED 11:09
 *   opencode-pushtodisplay Pinned the clock so the test passes. DONE 11:08
 *   opencode-pushtodisplay Allow bash: git push NEEDS 11:07
 *   qa running grep FAIL 11:06
 *   opencode-pushtodisplay running npm test OK 11:05
 *   opencode-pushtodisplay fix the flaky release test RUN 11:04
 *   opencode-pushtodisplay session opened READY 11:04
 *
 * Every line has the same four runs — agent, event, status, time — because a
 * panel is shared and a line without a speaker is unreadable. Colour is the
 * only thing that varies; see `messages.ts` and `payloads.ts`.
 *
 * Rendering model (from the Push To Display app): a message is ONE wrapping
 * paragraph; `blocks` are inline runs like `<span>`, not lines like `<p>`. So
 * each builder in `messages.ts` produces a single sentence.
 *
 * Authentication is OAuth-only (no API keys). It reuses the `pushtodisplay`
 * CLI, which implements the OAuth 2.0 device-code flow against
 * https://idp.pushtodisplay.com. Credentials live in the OS keychain (macOS
 * Keychain, Linux libsecret, Windows Credential Manager), with a plaintext
 * fallback at ~/.config/pushtodisplay/credentials.json only when no keychain
 * is available; the access token refreshes automatically.
 *
 *   /pushtodisplay-setup    log in if needed, send a test entry, enable updates
 *   /pushtodisplay-login    re-authenticate without clearing an existing setup
 *   /pushtodisplay-status   show current auth and setup state
 *   /pushtodisplay-test     send a test entry to the board (verify wiring)
 *   /pushtodisplay-clear    write a `log cleared` entry to this panel
 *
 * Optional env vars (plugin options override them):
 *   PUSHTODISPLAY_BOARD_ID      Send to a specific board (default: your default board)
 *   PUSHTODISPLAY_PANEL         (1-4) which panel this agent writes to (default 1)
 *   PUSHTODISPLAY_LABEL         agent name shown on every line (default: session title, then folder)
 *   PUSHTODISPLAY_STEPS         Set to "0" to skip per-tool entries
 *   PUSHTODISPLAY_DISABLED      Set to "1" to disable entirely.
 *
 * Setup gating: a shared login is not enough. Updates are sent only when this
 * OpenCode integration has its own setup marker *and* auth is valid. The marker
 * is written by `/pushtodisplay-setup` after a successful test entry; a fresh
 * install that reuses another integration's login stays silent until then.
 *
 * Auth gating: an unknown auth state *waits* for the probe rather than dropping
 * the message; a known-bad state drops, and re-probes lazily on the next send
 * (at most once per `PROBE_INTERVAL_MS`).
 *
 * Every API call counts toward the monthly message quota and is capped around
 * 1 msg/s by the Sandbox tier, so `sender.ts` keeps one ordered queue, spaced
 * and bounded.
 *
 * Subagent sessions are child sessions in OpenCode. Their prompts and tool
 * calls are deliberately not mirrored: the parent's `task` step already says a
 * delegation happened, and duplicating the child's whole run would turn one
 * board line into a noisy second log. A permission request from a child still
 * surfaces, using its parent's name, because a human must act on it.
 */
import { execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

import type { Plugin } from "@opencode/plugin";

import { clock, loadConfig, type ConfigOptions } from "./config.ts";
import {
  beginTask,
  createState,
  noteText,
  type PanelState,
} from "./panel-state.ts";
import {
  clearedMessage,
  sessionClosedMessage,
  sessionOpenedMessage,
  stepMessage,
  taskMessage,
  testMessage,
} from "./messages.ts";
import { AuthGate } from "./auth-gate.ts";
import { Sender } from "./sender.ts";
import type { Payload } from "./payloads.ts";
import {
  executionFailedPayload,
  executionInterruptedPayload,
  executionSucceededPayload,
  idlePayload,
  permissionPayload,
  sessionDeletedPayload,
  sessionOpenedPayload,
  sessionRenamedPayload,
  type LineOpts,
  type PermissionAskedEvent,
  type SessionCreatedEvent,
  type SessionDeletedEvent,
  type SessionFailedEvent,
  type SessionIdleEvent,
  type SessionInterruptedEvent,
  type SessionRenamedEvent,
  type SessionSucceededEvent,
  type SessionTextEndedEvent,
} from "./events.ts";
import {
  authStatus,
  cliNotFoundMessage,
  isAuthFailure,
  isCliMissing,
  PUSHTODISPLAY_CLI_VERSION,
  resolveCli,
  sendPayload,
  spawnCli,
} from "./cli-adapter.ts";
import { isSetupComplete, markSetupComplete } from "./setup-state.ts";

const execFileAsync = promisify(execFile);

type Context = Plugin.Context;
type Cleanup = Plugin.Cleanup;
type SessionID = Parameters<Context["session"]["get"]>[0]["sessionID"];
type Registration = Awaited<ReturnType<Context["session"]["hook"]>>;

/** Keep sends comfortably above the Sandbox tier's ~1 msg/s cap. */
const MIN_INTERVAL_MS = 1200;
/** Queued entries before the oldest steps are dropped (~30 s of lag). */
const MAX_PENDING = 25;
const PROBE_INTERVAL_MS = 20_000;

const EVENT_TYPES = [
  "session.created",
  "session.renamed",
  "session.deleted",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.execution.succeeded",
  "session.idle",
  "session.text.ended",
  "permission.asked",
  "location.shutdown",
] as const;

/** Optional knobs used by tests; production uses the defaults. */
export interface SetupDeps {
  intervalMs?: number;
  maxPending?: number;
  probeIntervalMs?: number;
  clock?: () => string;
  env?: NodeJS.ProcessEnv;
}

interface SessionState extends PanelState {
  id: string;
  /** Session title from `session.created` / `session.renamed`. */
  title: string;
  /** Parent session for a subagent session; empty for a top-level session. */
  parentID: string;
  /** Child sessions are tracked for permission ownership but never posted. */
  child: boolean;
  /** A READY line has been written (or a rename took its place). */
  opened: boolean;
  /** A prompt is running and has not settled yet. */
  running: boolean;
  /** An ENDED line has been written. */
  ended: boolean;
}

interface SessionHint {
  title?: string;
  cwd?: string;
  parentID?: string;
}

/**
 * Build the plugin setup function. `Plugin.define` wraps the default instance
 * in `src/index.ts`; tests call this factory with a zero send interval so the
 * wiring can be exercised without waiting on the production rate limit.
 */
export function createSetup(deps: SetupDeps = {}): (ctx: Context) => Promise<Cleanup | void> {
  const intervalMs = deps.intervalMs ?? MIN_INTERVAL_MS;
  const maxPending = deps.maxPending ?? MAX_PENDING;
  const probeIntervalMs = deps.probeIntervalMs ?? PROBE_INTERVAL_MS;
  const now = deps.clock ?? clock;

  return async function setup(ctx: Context): Promise<Cleanup | void> {
    const env = deps.env ?? process.env;
    const conf = loadConfig(env, ctx.options as ConfigOptions);
    if (conf.disabled) return;

    const states = new Map<string, SessionState>();
    const inflight = new Map<string, Promise<SessionState>>();
    const registrations: Registration[] = [];
    let authLostNotified = false;
    let setupMissingNotified = false;
    let cliMissingNotified = false;
    let loginProc: ChildProcess | null = null;

    const baseDir = String(ctx.location?.directory ?? process.cwd());
    const defaultAgent = () =>
      conf.label.trim() || path.basename(baseDir) || "agent";

    // ---- auth gating -------------------------------------------------------
    // "Unknown" and "known-unauthenticated" are different states. Waiting for
    // the first probe is mandatory: the turn that greets you right after a
    // reload has no tool calls, so if the probe has not answered yet, dropping
    // the task line and the result line means the whole turn produces nothing.
    const gate = new AuthGate(() => authStatus(), probeIntervalMs);

    function notifyAuthNeeded() {
      if (authLostNotified) return;
      authLostNotified = true;
      console.warn(
        "[pushtodisplay] Push To Display not authenticated — updates paused. Run /pushtodisplay-setup",
      );
    }

    function notifySetupNeeded() {
      if (setupMissingNotified) return;
      setupMissingNotified = true;
      console.warn(
        "[pushtodisplay] Push To Display setup has not been completed for OpenCode — updates paused. Run /pushtodisplay-setup",
      );
    }

    async function settleAuth(): Promise<boolean> {
      const ok = await gate.start();
      if (ok) authLostNotified = false;
      else notifyAuthNeeded();
      return ok;
    }

    function handleSendError(err: unknown) {
      if (isCliMissing(err)) {
        if (cliMissingNotified) return;
        cliMissingNotified = true;
        console.error(`[pushtodisplay] ${cliNotFoundMessage()}`);
        return;
      }
      if (isAuthFailure(err)) {
        // The gate re-probes on the next send (at most once per interval), so no
        // timer is needed here: a recovered login is noticed when it matters.
        gate.revoke();
        notifyAuthNeeded();
        return;
      }
      // Transient/network error — don't flip auth state, just don't spam logs.
      console.error("[pushtodisplay] send failed:", (err as Error)?.message ?? err);
    }

    // ---- transport ---------------------------------------------------------
    // Both gates are enforced at dispatch time so every entry is covered. A
    // shared credential is not enough: this OpenCode integration must also have
    // completed its own setup (auth check + successful test entry).
    const sender = new Sender(
      async (payload) => {
        if (!isSetupComplete(env)) {
          notifySetupNeeded();
          return;
        }
        // Waits for an in-flight probe instead of discarding the message: the
        // first seconds of a session are exactly when a fast turn reports.
        if (!(await gate.allowed())) return;
        await sendPayload(payload, conf.boardId);
      },
      intervalMs,
      maxPending,
      (err) => handleSendError(err),
    );

    // ---- session state -----------------------------------------------------
    function labelFor(s: SessionState): string {
      const explicit = conf.label.trim();
      if (explicit) return explicit;
      const title = s.title.trim();
      if (title) return title;
      return path.basename(s.cwd) || "agent";
    }

    function makeState(id: SessionID, hint: SessionHint = {}): SessionState {
      const cwd = hint.cwd || baseDir;
      const s: SessionState = {
        ...createState({
          agent: conf.label.trim() || path.basename(cwd) || "agent",
          cwd,
        }),
        id,
        title: hint.title ?? "",
        parentID: hint.parentID ?? "",
        child: Boolean(hint.parentID),
        opened: false,
        running: false,
        ended: false,
      };
      s.agent = labelFor(s);
      return s;
    }

    async function ensureSession(id: SessionID, hint?: SessionHint): Promise<SessionState> {
      const existing = states.get(id);
      if (existing) {
        if (hint?.title !== undefined) existing.title = hint.title;
        if (hint?.cwd) existing.cwd = hint.cwd;
        if (hint?.parentID !== undefined) {
          existing.parentID = hint.parentID;
          existing.child = Boolean(hint.parentID);
        }
        existing.agent = labelFor(existing);
        return existing;
      }

      const pending = inflight.get(id);
      if (pending) return pending;

      const p = (async () => {
        let info = hint;
        if (!info) {
          try {
            const got = await ctx.session.get({ sessionID: id });
            info = {
              title: got.title,
              cwd: got.location?.directory ? String(got.location.directory) : undefined,
              parentID: got.parentID ? String(got.parentID) : undefined,
            };
          } catch {
            info = { cwd: baseDir };
          }
        }
        const s = makeState(id, info);
        states.set(id, s);
        return s;
      })();

      inflight.set(id, p);
      try {
        return await p;
      } finally {
        inflight.delete(id);
      }
    }

    function lineOpts(s: SessionState): LineOpts {
      return { panelId: conf.panel, agent: s.agent, wall: now(), cwd: s.cwd };
    }

    function openSession(s: SessionState, payload?: Payload): void {
      if (s.child || s.opened || s.ended) return;
      s.opened = true;
      sender.enqueue(
        payload ??
          sessionOpenedMessage({ panelId: conf.panel, agent: s.agent, wall: now() }),
        { urgent: true },
      );
    }

    /** Ensure a top-level session exists and has said READY. */
    async function activeSession(id: SessionID, hint?: SessionHint): Promise<SessionState | null> {
      const s = await ensureSession(id, hint);
      if (s.child || s.ended) return null;
      if (!s.opened) openSession(s);
      return s;
    }

    /** Walk child sessions up to the top-level session that owns the board line. */
    async function ownerOf(s: SessionState): Promise<SessionState> {
      let current = s;
      const seen = new Set<string>();
      while (current.child && current.parentID && !seen.has(current.parentID)) {
        seen.add(current.parentID);
        current = await ensureSession(current.parentID as SessionID);
      }
      return current;
    }

    function endSession(s: SessionState, payload?: Payload): void {
      if (s.ended) return;
      s.ended = true;
      if (s.child || !s.opened) return;
      sender.enqueue(
        payload ??
          sessionClosedMessage({ panelId: conf.panel, agent: s.agent, wall: now() }),
        { urgent: true },
      );
    }

    async function endAllSessions(): Promise<void> {
      for (const s of states.values()) endSession(s);
    }

    function belongsHere(directory?: string): boolean {
      if (!directory) return true;
      return path.resolve(String(directory)) === path.resolve(baseDir);
    }

    // ---- event wiring ------------------------------------------------------
    // Eight events speak: the session opening, a rename, a new task, each
    // finished tool step, a provider error, a blocking permission, the end of a
    // run, and the session closing. Everything else is state.

    async function onSessionCreated(event: SessionCreatedEvent): Promise<void> {
      if (!belongsHere(event.data.location?.directory)) return;
      const s = await ensureSession(event.data.sessionID as SessionID, {
        title: event.data.title,
        cwd: event.data.location?.directory,
        parentID: event.data.parentID,
      });
      if (s.child) return;
      openSession(s, sessionOpenedPayload(event, lineOpts(s)));
    }

    async function onSessionRenamed(event: SessionRenamedEvent): Promise<void> {
      const id = event.data.sessionID as SessionID;
      const known = states.has(id);
      const s = await ensureSession(id);
      if (s.child || s.ended) return;
      const title = (event.data.title ?? "").trim();
      if (!title) return;
      // A rename that does not change the effective head is not news.
      if (known && title === s.title && s.opened) return;
      s.title = title;
      s.agent = labelFor(s);
      s.opened = true;
      sender.enqueue(
        sessionRenamedPayload(event, lineOpts(s)),
        { urgent: true },
      );
    }

    async function onSessionDeleted(event: SessionDeletedEvent): Promise<void> {
      const id = event.data.sessionID as SessionID;
      const s = states.get(id);
      if (!s) return;
      if (!s.child) endSession(s, sessionDeletedPayload(event, lineOpts(s)));
      states.delete(id);
      for (const [childID, child] of states) {
        if (child.parentID === String(id)) states.delete(childID);
      }
    }

    async function onExecutionFailed(event: SessionFailedEvent): Promise<void> {
      const s = await activeSession(event.data.sessionID as SessionID);
      if (!s || !s.running) return;
      s.running = false;
      s.closing = "";
      sender.enqueue(executionFailedPayload(event, lineOpts(s)), { urgent: true });
    }

    async function onExecutionInterrupted(event: SessionInterruptedEvent): Promise<void> {
      const s = await activeSession(event.data.sessionID as SessionID);
      if (!s || !s.running) return;
      s.running = false;
      s.closing = "";
      const payload = executionInterruptedPayload(event, lineOpts(s));
      if (payload) sender.enqueue(payload, { urgent: true });
    }

    /**
     * A run settled. OpenCode 2.2 reports this as
     * `session.execution.succeeded`; some versions also emit `session.idle`.
     * Whichever arrives first wins and clears the closing text, so the second
     * cannot post the same result twice.
     */
    async function settle(
      event: SessionIdleEvent | SessionSucceededEvent,
      payload: (opts: LineOpts & { text: string }) => Payload,
    ): Promise<void> {
      const s = await activeSession(event.data.sessionID as SessionID);
      if (!s) return;
      // Only a run that started with a prompt owes a result line. Command
      // execution and control actions can also settle a session, but their
      // output already arrives through `ctx.session.synthetic`.
      if (!s.running) return;
      const text = s.closing;
      s.running = false;
      s.closing = "";
      sender.enqueue(payload({ ...lineOpts(s), text }), { urgent: true });
    }

    async function onIdle(event: SessionIdleEvent): Promise<void> {
      return settle(event, (opts) => idlePayload(event, opts));
    }

    async function onExecutionSucceeded(event: SessionSucceededEvent): Promise<void> {
      return settle(event, (opts) => executionSucceededPayload(event, opts));
    }

    async function onTextEnded(event: SessionTextEndedEvent): Promise<void> {
      const s = await ensureSession(event.data.sessionID as SessionID);
      if (s.child) return;
      noteText(s, event.data.text ?? "");
    }

    async function onPermissionAsked(event: PermissionAskedEvent): Promise<void> {
      const s = await ensureSession(event.data.sessionID as SessionID);
      const owner = await ownerOf(s);
      if (owner.ended) return;
      if (!owner.opened) openSession(owner);
      sender.enqueue(permissionPayload(event, lineOpts(owner)), { urgent: true });
    }

    async function onShutdown(): Promise<void> {
      await endAllSessions();
      try {
        await sender.flush();
      } catch {
        // Already surfaced through handleSendError.
      }
    }

    async function handleEvent(event: unknown): Promise<void> {
      const type = (event as { type?: string }).type;
      switch (type) {
        case "session.created":
          return onSessionCreated(event as SessionCreatedEvent);
        case "session.renamed":
          return onSessionRenamed(event as SessionRenamedEvent);
        case "session.deleted":
          return onSessionDeleted(event as SessionDeletedEvent);
        case "session.execution.failed":
          return onExecutionFailed(event as SessionFailedEvent);
        case "session.execution.interrupted":
          return onExecutionInterrupted(event as SessionInterruptedEvent);
        case "session.execution.succeeded":
          return onExecutionSucceeded(event as SessionSucceededEvent);
        case "session.idle":
          return onIdle(event as SessionIdleEvent);
        case "session.text.ended":
          return onTextEnded(event as SessionTextEndedEvent);
        case "permission.asked":
          return onPermissionAsked(event as PermissionAskedEvent);
        case "location.shutdown":
          return onShutdown();
      }
    }

    // ---- prompt and tool hooks --------------------------------------------
    registrations.push(
      await ctx.session.hook("prompt", async (event) => {
        const s = await activeSession(event.sessionID);
        if (!s) return;
        beginTask(s, event.prompt?.text ?? "");
        s.running = true;
        sender.enqueue(
          taskMessage({
            panelId: conf.panel,
            agent: s.agent,
            wall: now(),
            task: s.task,
            cwd: s.cwd,
          }),
          { urgent: true },
        );
      }),
    );

    registrations.push(
      await ctx.tool.hook("execute.after", async (event) => {
        if (!conf.steps) return;
        const s = await activeSession(event.sessionID);
        if (!s) return;
        // Posted when the step finishes, so the line states what actually
        // happened instead of leaving a stale "running" behind it.
        sender.enqueue(
          stepMessage({
            panelId: conf.panel,
            agent: s.agent,
            wall: now(),
            toolName: event.tool,
            args: event.input,
            cwd: s.cwd,
            ok: event.status === "completed",
          }),
        );
      }),
    );

    // ---- commands ----------------------------------------------------------
    async function output(
      sessionID: SessionID,
      text: string,
      kind?: "login",
    ): Promise<void> {
      try {
        await ctx.session.synthetic({
          sessionID,
          text,
          resume: false,
          metadata: { source: "pushtodisplay", ...(kind ? { kind } : {}) },
        });
      } catch (err) {
        console.error("[pushtodisplay] could not write command output:", (err as Error)?.message ?? err);
      }
    }

    /**
     * The label for a command line, and a guarantee that the session's READY
     * line is already queued. A command can run before the asynchronous
     * `session.created` event is handled, and a test line must not overtake the
     * opening line it belongs to.
     */
    async function commandLabel(sessionID: SessionID): Promise<string> {
      const s = await activeSession(sessionID);
      return s?.agent || defaultAgent();
    }

    /** Start the device-code flow and resolve when it finishes. */
    function startLogin(sessionID: SessionID): Promise<boolean> {
      if (loginProc) {
        void output(sessionID, "Push To Display login already in progress.", "login");
        return Promise.resolve(false);
      }
      void output(sessionID, "Starting Push To Display OAuth login…");

      let child: ChildProcess;
      try {
        child = spawnCli(["auth", "login", "--device-code"]);
      } catch (err) {
        void output(
          sessionID,
          isCliMissing(err) ? cliNotFoundMessage() : `Could not start login: ${(err as Error)?.message ?? err}`,
          "login",
        );
        return Promise.resolve(false);
      }
      loginProc = child;

      let out = "";
      let opened = false;
      let announced = false;

      const relay = (chunk: Buffer | string) => {
        out += chunk.toString();
        const urls = out.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
        const complete = urls.find((u) => /[?&](user_code|code)=/i.test(u));
        const plain = urls.find((u) => !/[?&](user_code|code)=/i.test(u));
        // The "complete" link is convenient for the browser, but it is a bad
        // thing to paste: the device code ends up inside the URL. Show a clean
        // URL and keep the code on its own line.
        let displayUrl = plain ?? complete ?? urls[0] ?? "";
        if (!plain && complete) {
          try {
            const parsed = new URL(complete);
            parsed.searchParams.delete("user_code");
            parsed.searchParams.delete("code");
            displayUrl = parsed.toString();
          } catch {
            // Keep the raw URL if it is not a valid URL object.
          }
        }
        const code =
          out.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/)?.[0] ??
          out.match(/(?:code)[:\s]+([A-Z0-9][A-Z0-9-]{3,})/i)?.[1] ??
          "";
        if ((complete || plain) && !opened) {
          opened = true;
          void openBrowser(complete ?? plain!);
        }
        // One message carries both the clean link and the code so the TUI can
        // show them together instead of replacing one toast with another.
        if (displayUrl && code && !announced) {
          announced = true;
          void output(
            sessionID,
            `Open ${displayUrl} in a browser\nCode: ${code}`,
            "login",
          );
        }
      };

      child.stdout?.on("data", relay);
      // The CLI writes the device-code instructions to stderr, so both streams
      // are relayed; success text arrives on stdout.
      child.stderr?.on("data", relay);

      return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          resolve(ok);
        };

        child.on("error", (err) => {
          loginProc = null;
          void output(
            sessionID,
            isCliMissing(err) ? cliNotFoundMessage() : `Login failed to start: ${err.message}`,
            "login",
          );
          finish(false);
        });

        child.on("exit", (code) => {
          if (settled) return;
          loginProc = null;
          if (code === 0) {
            void gate.start().then((ok) => {
              if (ok) {
                authLostNotified = false;
                void output(
                  sessionID,
                  isSetupComplete(env)
                    ? "✅ Connected to Push To Display!"
                    : "✅ Connected to Push To Display! Run /pushtodisplay-setup to finish setup.",
                  "login",
                );
              } else {
                void output(
                  sessionID,
                  "Login finished, but Push To Display auth is still unavailable. Run /pushtodisplay-setup to retry.",
                  "login",
                );
              }
              finish(ok);
            });
          } else {
            void output(sessionID, `Login failed or was cancelled (exit ${code ?? "?"}).`, "login");
            finish(false);
          }
        });
      });
    }

    /**
     * Send the setup test entry, then write the per-OpenCode marker. The marker
     * is written only after both auth and the test send succeeded.
     */
    async function finishSetup(sessionID: SessionID): Promise<boolean> {
      const authed = await gate.recheck();
      if (!authed) {
        notifyAuthNeeded();
        await output(
          sessionID,
          "⚠️ Setup stopped — Push To Display is not authenticated. Run /pushtodisplay-setup to retry.",
        );
        return false;
      }
      authLostNotified = false;

      const agent = await commandLabel(sessionID);
      try {
        await sender.flush();
        await sendPayload(
          testMessage({ panelId: conf.panel, agent, wall: now() }),
          conf.boardId,
        );
      } catch (err) {
        handleSendError(err);
        const detail = (err as Error)?.message ?? String(err);
        await output(sessionID, `⚠️ Setup stopped — test update failed: ${detail}`);
        return false;
      }

      const record = markSetupComplete(
        {
          boardId: conf.boardId,
          panel: conf.panel,
          label: agent,
          cliVersion: PUSHTODISPLAY_CLI_VERSION,
        },
        env,
      );
      setupMissingNotified = false;

      // Lines queued before the marker existed were intentionally dropped.
      // Let the next event write READY again for sessions that are still open.
      for (const session of states.values()) {
        if (!session.ended) session.opened = false;
      }

      await output(
        sessionID,
        `✅ Push To Display setup complete. Test entry sent to panel ${record.panel}${
          record.boardId ? ` on board ${record.boardId}` : ""
        }. Updates are now enabled.`,
      );
      return true;
    }

    async function runSetup(sessionID: SessionID): Promise<void> {
      const authed = await gate.recheck();
      if (!authed) {
        await output(sessionID, "Push To Display is not logged in. Starting login…", "login");
        const ok = await startLogin(sessionID);
        if (!ok) {
          await output(
            sessionID,
            "⚠️ Setup stopped — login did not complete. Run /pushtodisplay-setup to retry.",
          );
          return;
        }
      } else {
        await output(sessionID, "Push To Display is already authenticated. Sending a test entry…");
      }
      await finishSetup(sessionID);
    }

    const commandRegistration = await ctx.command.transform((editor) => {
      editor.add({
        name: "pushtodisplay-setup",
        description:
          "Set up Push To Display for OpenCode: log in if needed, send a test entry, and enable updates",
        execute: async ({ sessionID }) => {
          await runSetup(sessionID);
        },
      });

      editor.add({
        name: "pushtodisplay-login",
        description: "Re-authenticate with Push To Display (OAuth device-code flow)",
        execute: async ({ sessionID }) => {
          void startLogin(sessionID);
        },
      });

      editor.add({
        name: "pushtodisplay-status",
        description: "Show Push To Display authentication and setup status",
        execute: async ({ sessionID }) => {
          const authed = await gate.recheck();
          const setup = isSetupComplete(env);
          const text = authed
            ? setup
              ? "✅ Push To Display authenticated and set up"
              : "⚠️ Push To Display authenticated, but OpenCode setup is incomplete — run /pushtodisplay-setup"
            : "⚠️ Push To Display not authenticated — run /pushtodisplay-setup";
          await output(sessionID, text);
        },
      });

      editor.add({
        name: "pushtodisplay-test",
        description: "Send a test update to your Push To Display board",
        execute: async ({ sessionID }) => {
          // Probe on demand: right after a reload the cached flag is still
          // false while the startup probe is in flight.
          if (!(await gate.allowed())) {
            await output(sessionID, "⚠️ Not authenticated — run /pushtodisplay-setup first");
            return;
          }
          const setup = isSetupComplete(env);
          const agent = await commandLabel(sessionID);
          try {
            // Let the session's READY line (and any earlier steps) reach the
            // board first; the test is a direct send so it can report errors.
            await sender.flush();
            await sendPayload(
              testMessage({ panelId: conf.panel, agent, wall: now() }),
              conf.boardId,
            );
            await output(
              sessionID,
              setup
                ? "Test update sent"
                : "Test update sent. Run /pushtodisplay-setup to enable automatic updates.",
            );
          } catch (err) {
            handleSendError(err);
            const detail = (err as Error)?.message ?? String(err);
            await output(sessionID, `Test update failed: ${detail}`);
          }
        },
      });

      editor.add({
        name: "pushtodisplay-clear",
        description: "Write a `log cleared` entry to this agent's panel",
        execute: async ({ sessionID }) => {
          if (!isSetupComplete(env)) {
            await output(sessionID, "⚠️ Setup is incomplete — run /pushtodisplay-setup first");
            return;
          }
          const agent = await commandLabel(sessionID);
          sender.enqueue(
            clearedMessage({ panelId: conf.panel, agent, wall: now() }),
            { urgent: true },
          );
          await output(sessionID, "Panel cleared");
        },
      });
    });
    registrations.push(commandRegistration);

    // ---- event subscription ------------------------------------------------
    const controller = new AbortController();
    const eventLoop = (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          types: [...EVENT_TYPES],
          signal: controller.signal,
        })) {
          try {
            await handleEvent(event);
          } catch (err) {
            console.error("[pushtodisplay] event handler failed:", (err as Error)?.message ?? err);
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("[pushtodisplay] event stream failed:", (err as Error)?.message ?? err);
        }
      }
    })();

    // Probe once at load only when this integration is already set up. A fresh
    // install may share another integration's login, but it stays silent until
    // /pushtodisplay-setup has verified auth and sent its test entry.
    if (isSetupComplete(env)) {
      void settleAuth();
    } else {
      notifySetupNeeded();
    }

    // ---- cleanup -----------------------------------------------------------
    return async () => {
      controller.abort();
      await eventLoop.catch(() => {});
      for (const registration of registrations) {
        try {
          await registration.dispose();
        } catch {
          // The plugin is unloading; a registration that is already gone is fine.
        }
      }
      await endAllSessions();
      try {
        await sender.flush();
      } catch {
        // Already surfaced through handleSendError.
      }
    };
  };
}

/** The production setup: rate-limited, real clock, real environment. */
export default createSetup();

/** Exported for diagnostics in tests and troubleshooting. */
export { resolveCli };

function openBrowser(url: string): Promise<unknown> {
  const { platform } = process;
  if (platform === "darwin") return execFileAsync("open", [url]).catch(() => {});
  if (platform === "win32") return execFileAsync("cmd", ["/c", "start", "", url]).catch(() => {});
  return execFileAsync("xdg-open", [url]).catch(() => {});
}
