/**
 * One message per event, and every message has exactly the same shape.
 *
 * A panel is a **shared** scrolling log: several agents may write to the same
 * panel, so each line identifies its speaker. A message is one wrapping
 * paragraph of inline runs (blocks behave like `<span>`), so the whole line is
 * a single sentence:
 *
 *   release running grep FAIL 11:04
 *   qa Allow bash: git push NEEDS 11:07
 *   release Pinned the clock so the release test passes. DONE 11:08
 *
 * One entry per event, written as one sentence. Bodies are shortened by
 * structure and then by a character budget (`describe.ts` and `PROSE_MAX`),
 * preferring word boundaries, so the fields flow in a fixed order.
 *
 *   <agent> <what happened> <STATUS> <HH:MM>
 *
 * The agent name leads, so a shared panel reads as one column per agent. There
 * is no separator glyph: the fields are plain words at one size, and the upper
 * case status is what marks the end of the event.
 */
import { describeTool, shortenPath, tidyText } from "./describe.ts";
import { truncate } from "./config.ts";
import {
  ACCENT,
  STATUS_COLOR,
  SURFACE,
  TEXT,
  TEXT_DIM,
  type Payload,
} from "./payloads.ts";

/** HH:MM — a full timestamp is noise in a trail. */
const hhmm = (wall: string) => wall.slice(0, 5);

/** Collapse whitespace so a multi-line provider error stays one line. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** Collapse whitespace, then fall back — never let a field render as blank. */
const say = (text: string, fallback: string) => oneLine(text ?? "") || fallback;

/** The only status words that may appear in a line. */
export type Status = "ready" | "run" | "ok" | "fail" | "needs" | "done" | "stop" | "ended";

/**
 * The one shape every message uses: four inline runs, one surface.
 */
function line(opts: {
  panelId: number;
  agent: string;
  wall: string;
  body: string;
  status: Status;
}): Payload {
  // Four inline runs on one shared surface: name, body, status, time. Size and
  // weight are left to the renderer (`medium` / regular), so colour is what
  // expresses the run boundary; the status is also upper case. No separator
  // glyph: each run carries its own leading space, and the fields stay readable
  // if the paragraph wraps.
  const run = (text: string, color: string) => ({ text, color });
  return {
    panelId: opts.panelId,
    density: "compact",
    background: SURFACE,
    blocks: [
      run(opts.agent, ACCENT),
      run(` ${oneLine(opts.body)}`, TEXT),
      run(` ${opts.status.toUpperCase()}`, STATUS_COLOR[opts.status]),
      run(` ${hhmm(opts.wall)}`, TEXT_DIM),
    ],
  };
}

/**
 * The panel's own lifecycle.
 *
 * Lifecycle lines are the only entries about the session rather than about
 * work, and they exist because silence is otherwise ambiguous: a finished
 * agent, a killed one, and one stuck in a four-minute test look identical.
 * Open and close bracket a session — on a reload they appear as a pair, which
 * is the truth.
 */
export function sessionOpenedMessage(opts: {
  panelId: number;
  agent: string;
  wall: string;
}): Payload {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: "session opened",
    status: "ready",
  });
}

export function sessionClosedMessage(opts: {
  panelId: number;
  agent: string;
  wall: string;
}): Payload {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: "session closed",
    status: "ended",
  });
}

/** The session was renamed: say so, since it changes every line's head. */
export function renamedMessage(opts: {
  panelId: number;
  agent: string;
  wall: string;
}): Payload {
  // The new name is already the first field, so the body only has to say what
  // happened.
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: "session renamed",
    status: "ready",
  });
}

/** A run starts: the prompt this agent was handed. */
export function taskMessage(opts: {
  panelId: number;
  agent: string;
  wall: string;
  task: string;
  cwd?: string;
}): Payload {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    // Paths first (so a pasted temp path cannot eat the budget), then the same
    // sentence-and-cap treatment the result gets.
    body: say(shortenProse(tidyText(opts.task, { cwd: opts.cwd })), "new task"),
    status: "run",
  });
}

/**
 * A tool step, posted when it *finishes* — so every step line carries a true
 * outcome instead of claiming "running" forever after it is over.
 */
export function stepMessage(opts: {
  panelId: number;
  agent: string;
  wall: string;
  toolName: string;
  args: unknown;
  cwd: string;
  ok: boolean;
}): Payload {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: describeTool(opts.toolName, opts.args, { cwd: opts.cwd }),
    status: opts.ok ? "ok" : "fail",
  });
}

/**
 * Longest prose body — the prompt and the result, which are the only two bodies
 * we did not write ourselves.
 *
 * 60 characters is under two rows at `medium`. Enough for the ask or the
 * answer to be recognisable, short enough that a pasted paragraph does not push
 * the rest of the log off the panel.
 */
const PROSE_MAX = 60;

/**
 * Cut free text to something a person can read on a board.
 *
 * The first sentence carries the ask/answer and the rest is detail, so the first
 * sentence of usable length wins; only if that is still too long do we fall back
 * to a word-boundary cut. Used for both the prompt and the result — a prompt is
 * frequently a pasted wall of text, and it is the same problem.
 */
export function shortenProse(text: string): string {
  const clean = oneLine(text);
  if (!clean) return "";
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const lead = sentences.find((s) => s.length >= 12) ?? sentences[0] ?? clean;
  return truncate(lead, PROSE_MAX);
}

/** The run finished on its own: say what it produced. */
export function doneMessage(opts: {
  panelId: number;
  agent: string;
  wall: string;
  text: string;
}): Payload {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: say(shortenProse(opts.text), "no summary"),
    status: "done",
  });
}

/** Default bodies for the blocking prompt kinds, when the prompt has no title. */
const WANTS: Record<string, string> = {
  confirm: "waiting for your approval",
  select: "waiting for you to choose",
  input: "waiting for you to type something",
  editor: "waiting for you to edit something",
  custom: "waiting for your input",
};

/** A prompt is blocking the run: the one status a human must act on. */
export function blockedMessage(opts: {
  panelId: number;
  agent: string;
  wall: string;
  kind: string;
  title?: string;
}): Payload {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: say(opts.title ?? "", WANTS[opts.kind] ?? "waiting for your input"),
    status: "needs",
  });
}

/**
 * OpenCode's permission action names are slightly more abstract than the tool
 * names a person sees (`shell` for the bash tool, `subagent` for task). The
 * board keeps the familiar tool name, matching the step lines above it.
 */
const PERMISSION_ACTION_LABEL: Record<string, string> = {
  shell: "bash",
  subagent: "task",
};

/**
 * The body of a permission line: what the agent wants to do.
 *
 * OpenCode reports an action (`shell`, `edit`, ...) plus the resources it would
 * touch. The action is the verb a person recognises, so it leads; the first
 * resource identifies the target and any further resources are only counted.
 */
export function permissionBody(
  action: string,
  resources: readonly string[] = [],
  cwd?: string,
): string {
  const raw = oneLine(action ?? "");
  const verb = PERMISSION_ACTION_LABEL[raw] ?? raw;
  const first = resources.find((r) => typeof r === "string" && r.trim()) ?? "";
  const target = first ? shortenPath(first, { cwd }) : "";
  const more = resources.length > 1 ? ` +${resources.length - 1}` : "";
  if (!verb) return target ? `Allow ${target}${more}` : "waiting for your permission";
  return target ? `Allow ${verb}: ${target}${more}` : `Allow ${verb}`;
}

/** A permission request is blocking the run: the one status a human must act on. */
export function permissionMessage(opts: {
  panelId: number;
  agent: string;
  wall: string;
  action: string;
  resources?: readonly string[];
  message?: string;
  cwd?: string;
}): Payload {
  const body =
    say(opts.message ?? "", "") ||
    permissionBody(opts.action, opts.resources ?? [], opts.cwd);
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: truncate(body, PROSE_MAX),
    status: "needs",
  });
}

/** You pressed Escape. Distinct from FAIL: nothing went wrong. */
export function stoppedMessage(opts: { panelId: number; agent: string; wall: string }): Payload {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: "interrupted before it finished",
    status: "stop",
  });
}

/**
 * The model or the provider failed — context overflow, rate limit, a 500.
 * OpenCode reports a structured error on `session.execution.failed`.
 */
export function errorDetail(error: {
  message?: string;
  type?: string;
  status?: number;
  response?: { body?: string };
}): string {
  const message = oneLine(error?.message ?? "");
  if (message) {
    // The message often already says "HTTP 500"; don't repeat it.
    if (error.status && !new RegExp(`\\b${error.status}\\b`).test(message)) {
      return `HTTP ${error.status} ${message}`;
    }
    return message;
  }
  return oneLine(error?.type ?? "") || oneLine(error?.response?.body ?? "");
}

export function errorMessage(opts: {
  panelId: number;
  agent: string;
  wall: string;
  detail: string;
}): Payload {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: say(opts.detail, "the model call failed"),
    status: "fail",
  });
}

/** Wiring check for /pushtodisplay-test. */
export function testMessage(opts: { panelId: number; agent: string; wall: string }): Payload {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: `link OK, panel ${opts.panelId}`,
    status: "ok",
  });
}

/** Written by /pushtodisplay-clear. */
export function clearedMessage(opts: { panelId: number; agent: string; wall: string }): Payload {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: "log cleared",
    status: "ok",
  });
}
