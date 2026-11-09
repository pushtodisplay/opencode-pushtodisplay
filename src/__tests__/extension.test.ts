/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Plugin } from "@opencode/plugin";
import type { Payload } from "../payloads.ts";

/**
 * The CLI adapter is mocked so these tests exercise the event/command wiring,
 * not a live OAuth session. The mock state lives on `globalThis` because
 * jest.mock factories run while the module graph is still being initialised.
 */
jest.mock("../cli-adapter.ts", () => {
  const makeStream = () => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    return {
      on(event: string, cb: (...args: unknown[]) => void) {
        (listeners[event] ??= []).push(cb);
        return this;
      },
      emit(event: string, ...args: unknown[]) {
        for (const cb of listeners[event] ?? []) cb(...args);
      },
    };
  };

  const makeChild = () => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    const child: any = {
      stdout: makeStream(),
      stderr: makeStream(),
      on(event: string, cb: (...args: unknown[]) => void) {
        (listeners[event] ??= []).push(cb);
        return child;
      },
      emit(event: string, ...args: unknown[]) {
        for (const cb of listeners[event] ?? []) cb(...args);
      },
      kill() {},
    };
    return child;
  };

  const state = {
    sent: [] as Payload[],
    outputs: [] as string[],
    auth: true,
    authCalls: 0,
    spawnCli: jest.fn(() => makeChild()),
  };
  (globalThis as any).__ptd = state;

  return {
    sendPayload: jest.fn(async (payload: Payload) => {
      state.sent.push(payload);
    }),
    authStatus: jest.fn(async () => {
      state.authCalls += 1;
      return state.auth;
    }),
    spawnCli: state.spawnCli,
    isAuthFailure: (err: unknown) => /unauthor|401|403|forbidden/i.test((err as Error)?.message ?? ""),
    isCliMissing: (err: unknown) => (err as NodeJS.ErrnoException)?.code === "ENOENT",
    cliNotFoundMessage: () => "cli missing",
    resolveCli: () => ({ exe: "pushtodisplay", prefix: [], source: "path" as const }),
  };
});

import { createSetup } from "../extension.ts";

interface MockState {
  sent: Payload[];
  outputs: string[];
  auth: boolean;
  authCalls: number;
  spawnCli: jest.Mock;
}

const mock = (globalThis as unknown as { __ptd: MockState }).__ptd;

const WALL = "11:04:22";
const lines = () => mock.sent.map((p) => p.blocks.map((b) => b.text).join(""));

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_500): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting; lines=${JSON.stringify(lines())}`);
    }
    await delay(5);
  }
}

interface Fake {
  sessionHooks: Map<string, (event: any) => unknown>;
  toolHooks: Map<string, (event: any) => unknown>;
  commands: Map<string, any>;
  infos: Map<string, any>;
  outputs: string[];
  syntheticCalls: Array<{ sessionID: string; text: string; resume?: boolean }>;
  cleanup: (() => Promise<void> | void) | undefined;
  emit: (event: unknown) => void;
}

async function fake(opts: {
  env?: NodeJS.ProcessEnv;
  options?: Record<string, unknown>;
} = {}): Promise<Fake> {
  const sessionHooks = new Map<string, (event: any) => unknown>();
  const toolHooks = new Map<string, (event: any) => unknown>();
  const commands = new Map<string, any>();
  const infos = new Map<string, any>();
  const outputs: string[] = [];
  const syntheticCalls: Array<{ sessionID: string; text: string; resume?: boolean }> = [];
  const queue: unknown[] = [];
  let wake: (() => void) | null = null;
  let aborted = false;

  const stream = (signal?: AbortSignal) => {
    const onAbort = () => {
      aborted = true;
      wake?.();
      wake = null;
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    return (async function* () {
      try {
        while (!aborted) {
          if (!queue.length) {
            await new Promise<void>((r) => {
              wake = r;
            });
            continue;
          }
          yield queue.shift();
        }
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    })();
  };

  const ctx = {
    options: opts.options ?? {},
    location: {
      directory: "/repo",
      project: { id: "project", directory: "/repo", canonical: "/repo" },
    },
    session: {
      hook: jest.fn(async (name: string, cb: (event: any) => unknown) => {
        sessionHooks.set(name, cb);
        return { dispose: async () => {} };
      }),
      get: jest.fn(async ({ sessionID }: { sessionID: string }) => {
        return (
          infos.get(sessionID) ?? {
            id: sessionID,
            location: { directory: "/repo" },
          }
        );
      }),
      synthetic: jest.fn(
        async ({ sessionID, text, resume }: { sessionID: string; text: string; resume?: boolean }) => {
          outputs.push(text);
          syntheticCalls.push({ sessionID, text, resume });
          return {};
        },
      ),
    },
    tool: {
      hook: jest.fn(async (name: string, cb: (event: any) => unknown) => {
        toolHooks.set(name, cb);
        return { dispose: async () => {} };
      }),
    },
    command: {
      transform: jest.fn(async (cb: (editor: any) => void) => {
        cb({ add: (definition: any) => commands.set(definition.name, definition) });
        return { dispose: async () => {} };
      }),
    },
    event: {
      subscribe: jest.fn(({ signal }: { signal?: AbortSignal }) => stream(signal)),
    },
  };

  const setup = createSetup({
    intervalMs: 0,
    probeIntervalMs: 0,
    clock: () => WALL,
    env: opts.env ?? {},
  });
  const cleanup = await setup(ctx as unknown as Plugin.Context);

  return {
    sessionHooks,
    toolHooks,
    commands,
    infos,
    outputs,
    syntheticCalls,
    cleanup: typeof cleanup === "function" ? cleanup : undefined,
    emit(event: unknown) {
      queue.push(event);
      wake?.();
      wake = null;
    },
  };
}

const created = (sessionID: string, title?: string, parentID?: string) => ({
  type: "session.created",
  data: { sessionID, title, parentID, location: { directory: "/repo" } },
});

const prompt = (sessionID: string, text: string) => ({
  sessionID,
  prompt: { text },
});

const tool = (sessionID: string, name: string, input: unknown, ok = true) => ({
  tool: name,
  sessionID,
  input,
  status: ok ? "completed" : "error",
});

const textEnded = (sessionID: string, text: string) => ({
  type: "session.text.ended",
  data: { sessionID, text },
});

const idle = (sessionID: string) => ({ type: "session.idle", data: { sessionID } });
const succeeded = (sessionID: string) => ({
  type: "session.execution.succeeded",
  data: { sessionID },
});

beforeEach(() => {
  mock.sent.length = 0;
  mock.outputs.length = 0;
  mock.auth = true;
  mock.authCalls = 0;
  mock.spawnCli.mockClear();
  // The logged-out test intentionally exercises the warning path.
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("event wiring", () => {
  it("posts READY, RUN, OK, DONE and ENDED in order", async () => {
    const f = await fake();
    f.emit(created("s1", "release"));
    await waitFor(() => lines().length >= 1);
    await f.sessionHooks.get("prompt")!(prompt("s1", "fix the flaky test"));
    await waitFor(() => lines().length >= 2);
    await f.toolHooks.get("execute.after")!(
      tool("s1", "bash", { command: "npm test" }),
    );
    await waitFor(() => lines().length >= 3);
    f.emit(textEnded("s1", "Pinned the clock so the release test passes. Extra detail."));
    f.emit(succeeded("s1"));
    await waitFor(() => lines().length >= 4);

    expect(lines()).toEqual([
      "release session opened READY 11:04",
      "release fix the flaky test RUN 11:04",
      "release running npm test OK 11:04",
      "release Pinned the clock so the release test passes. DONE 11:04",
    ]);

    await f.cleanup?.();
    expect(lines().at(-1)).toBe("release session closed ENDED 11:04");
    expect(lines().filter((l) => l.includes("ENDED"))).toHaveLength(1);
  });

  it("uses session.idle as a fallback settle signal without duplicating DONE", async () => {
    const f = await fake();
    f.emit(created("s1", "release"));
    await waitFor(() => lines().length >= 1);
    await f.sessionHooks.get("prompt")!(prompt("s1", "run the tests"));
    f.emit(textEnded("s1", "All tests pass."));
    f.emit(succeeded("s1"));
    await waitFor(() => lines().some((l) => l.includes(" DONE ")));
    f.emit(idle("s1"));
    await delay(50);
    expect(lines().filter((l) => l.includes(" DONE "))).toHaveLength(1);
    await f.cleanup?.();
  });

  it("reports failed steps and execution errors", async () => {
    const f = await fake();
    f.emit(created("s1", "release"));
    await waitFor(() => lines().length >= 1);
    await f.sessionHooks.get("prompt")!(prompt("s1", "run the tests"));
    await f.toolHooks.get("execute.after")!(
      tool("s1", "bash", { command: "npm test" }, false),
    );
    await waitFor(() => lines().some((l) => l.includes("FAIL")));

    f.emit({
      type: "session.execution.failed",
      data: {
        sessionID: "s1",
        error: { type: "provider.error", message: "upstream timed out", status: 500 },
      },
    });
    await waitFor(() => lines().some((l) => l.includes("HTTP 500 upstream timed out FAIL")));

    // A failed run has already settled; a later idle must not add DONE.
    f.emit(idle("s1"));
    await delay(50);
    expect(lines().some((l) => l.includes(" DONE "))).toBe(false);
    expect(lines()).toEqual([
      "release session opened READY 11:04",
      "release run the tests RUN 11:04",
      "release running npm test FAIL 11:04",
      "release HTTP 500 upstream timed out FAIL 11:04",
    ]);
    await f.cleanup?.();
  });

  it("posts STOP for a user interrupt and never a DONE for the same run", async () => {
    const f = await fake();
    f.emit(created("s1", "release"));
    await waitFor(() => lines().length >= 1);
    await f.sessionHooks.get("prompt")!(prompt("s1", "run the slow tests"));

    f.emit({
      type: "session.execution.interrupted",
      data: { sessionID: "s1", reason: "user" },
    });
    await waitFor(() => lines().some((l) => l.includes("STOP")));
    f.emit(idle("s1"));
    await delay(50);
    expect(lines().some((l) => l.includes(" DONE "))).toBe(false);
    expect(lines().at(-1)).toBe("release interrupted before it finished STOP 11:04");
    await f.cleanup?.();
  });

  it("posts a permission request as NEEDS", async () => {
    const f = await fake();
    f.emit(created("s1", "release"));
    await waitFor(() => lines().length >= 1);
    f.emit({
      type: "permission.asked",
      data: {
        id: "p1",
        sessionID: "s1",
        action: "bash",
        resources: ["git push --force-with-lease"],
      },
    });
    await waitFor(() => lines().some((l) => l.includes("NEEDS")));
    expect(lines().at(-1)).toBe(
      "release Allow bash: git push --force-with-lease NEEDS 11:04",
    );
    await f.cleanup?.();
  });

  it("ignores child-session activity but surfaces its permission under the parent name", async () => {
    const f = await fake();
    f.infos.set("child", {
      id: "child",
      parentID: "s1",
      title: "subagent",
      location: { directory: "/repo" },
    });
    f.emit(created("s1", "release"));
    await waitFor(() => lines().length >= 1);
    f.emit(created("child", "subagent", "s1"));
    await delay(20);

    await f.sessionHooks.get("prompt")!(prompt("child", "review the auth code"));
    await f.toolHooks.get("execute.after")!(
      tool("child", "read", { filePath: "/repo/src/auth.ts" }),
    );
    f.emit(textEnded("child", "Child result."));
    f.emit(idle("child"));
    await delay(50);
    expect(lines()).toEqual(["release session opened READY 11:04"]);

    f.emit({
      type: "permission.asked",
      data: {
        id: "p1",
        sessionID: "child",
        action: "bash",
        resources: ["git push"],
      },
    });
    await waitFor(() => lines().some((l) => l.includes("NEEDS")));
    expect(lines().at(-1)).toBe("release Allow bash: git push NEEDS 11:04");
    await f.cleanup?.();
  });

  it("posts a rename and uses the new name on later lines", async () => {
    const f = await fake();
    f.emit(created("s1", "release"));
    await waitFor(() => lines().length >= 1);
    f.emit({ type: "session.renamed", data: { sessionID: "s1", title: "qa" } });
    await waitFor(() => lines().some((l) => l.includes("session renamed")));
    expect(lines().at(-1)).toBe("qa session renamed READY 11:04");

    await f.sessionHooks.get("prompt")!(prompt("s1", "run the release checks"));
    await waitFor(() => lines().some((l) => l.includes("run the release checks")));
    expect(lines().at(-1)).toBe("qa run the release checks RUN 11:04");
    await f.cleanup?.();
  });

  it("posts ENDED when a session is deleted, without a duplicate on cleanup", async () => {
    const f = await fake();
    f.emit(created("s1", "release"));
    await waitFor(() => lines().length >= 1);
    f.emit({ type: "session.deleted", data: { sessionID: "s1" } });
    await waitFor(() => lines().some((l) => l.includes("ENDED")));
    await f.cleanup?.();
    expect(lines().filter((l) => l.includes("ENDED"))).toHaveLength(1);
  });

  it("omits per-tool lines when PUSHTODISPLAY_STEPS=0", async () => {
    const f = await fake({ env: { PUSHTODISPLAY_STEPS: "0" } });
    f.emit(created("s1", "release"));
    await waitFor(() => lines().length >= 1);
    await f.sessionHooks.get("prompt")!(prompt("s1", "run the tests"));
    await f.toolHooks.get("execute.after")!(
      tool("s1", "bash", { command: "npm test" }),
    );
    await waitFor(() => lines().length >= 2);
    await delay(30);
    expect(lines()).toEqual([
      "release session opened READY 11:04",
      "release run the tests RUN 11:04",
    ]);
    await f.cleanup?.();
  });

  it("honours plugin options over the environment", async () => {
    const f = await fake({
      env: { PUSHTODISPLAY_LABEL: "env-label", PUSHTODISPLAY_PANEL: "1" },
      options: { label: "cicd", panel: 3, steps: false, boardId: "board-x" },
    });
    f.emit(created("s1", "release"));
    await waitFor(() => lines().length >= 1);
    expect(lines()[0]).toBe("cicd session opened READY 11:04");
    expect(mock.sent[0]?.panelId).toBe(3);
    await f.cleanup?.();
  });

  it("does nothing when disabled", async () => {
    const f = await fake({ env: { PUSHTODISPLAY_DISABLED: "1" } });
    expect(f.cleanup).toBeUndefined();
    expect(f.sessionHooks.size).toBe(0);
    expect(f.toolHooks.size).toBe(0);
    expect(f.commands.size).toBe(0);
  });
});

describe("commands", () => {
  it("registers every documented command", async () => {
    const f = await fake();
    expect([...f.commands.keys()].sort()).toEqual([
      "pushtodisplay-clear",
      "pushtodisplay-login",
      "pushtodisplay-status",
      "pushtodisplay-test",
    ]);
    for (const command of f.commands.values()) {
      expect(command.description).toBeTruthy();
      expect(typeof command.execute).toBe("function");
    }
    await f.cleanup?.();
  });

  it("writes command output without resuming the model", async () => {
    const f = await fake();
    await f.commands.get("pushtodisplay-status")!.execute({
      sessionID: "s1",
      prompt: { text: "" },
      delivery: "steer",
    });
    expect(f.syntheticCalls.at(-1)).toMatchObject({
      sessionID: "s1",
      resume: false,
    });
    await f.cleanup?.();
  });

  it("status probes auth and writes the result into the session", async () => {
    const f = await fake();
    await f.commands.get("pushtodisplay-status")!.execute({
      sessionID: "s1",
      prompt: { text: "" },
      delivery: "steer",
    });
    expect(f.outputs.at(-1)).toContain("authenticated");
    await f.cleanup?.();
  });

  it("test sends a wiring-check line directly", async () => {
    const f = await fake();
    await f.commands.get("pushtodisplay-test")!.execute({
      sessionID: "s1",
      prompt: { text: "" },
      delivery: "steer",
    });
    await waitFor(() => lines().some((l) => l.includes("link OK")));
    expect(lines()).toEqual([
      "repo session opened READY 11:04",
      "repo link OK, panel 1 OK 11:04",
    ]);
    expect(f.outputs.at(-1)).toBe("Test update sent");
    await f.cleanup?.();
  });

  it("clear enqueues a log-cleared line after the session opens", async () => {
    const f = await fake();
    await f.commands.get("pushtodisplay-clear")!.execute({
      sessionID: "s1",
      prompt: { text: "" },
      delivery: "steer",
    });
    await waitFor(() => lines().some((l) => l.includes("log cleared")));
    expect(lines()).toEqual([
      "repo session opened READY 11:04",
      "repo log cleared OK 11:04",
    ]);
    expect(f.outputs.at(-1)).toBe("Panel cleared");
    await f.cleanup?.();
  });

  it("drops while logged out, then sends again after status re-probes", async () => {
    mock.auth = false;
    const f = await fake();
    f.emit(created("s1", "release"));
    await waitFor(() => mock.authCalls >= 1);
    await delay(50);
    expect(mock.sent).toHaveLength(0);

    mock.auth = true;
    await f.commands.get("pushtodisplay-status")!.execute({
      sessionID: "s1",
      prompt: { text: "" },
      delivery: "steer",
    });
    f.emit({ type: "session.renamed", data: { sessionID: "s1", title: "qa" } });
    await waitFor(() => lines().length >= 1);
    expect(lines().at(-1)).toBe("qa session renamed READY 11:04");
    await f.cleanup?.();
  });

  it("login relays the URL and code from the CLI's stderr and re-probes on success", async () => {
    const f = await fake();
    await f.commands.get("pushtodisplay-login")!.execute({
      sessionID: "s1",
      prompt: { text: "" },
      delivery: "steer",
    });
    expect(mock.spawnCli).toHaveBeenCalledWith(["auth", "login", "--device-code"]);
    const child = mock.spawnCli.mock.results.at(-1)!.value as any;
    child.stderr.emit(
      "data",
      Buffer.from(
        "To sign in, open this URL in a browser:\n" +
          "  https://idp.pushtodisplay.com/device?user_code=ABCD-1234\n" +
          "Then enter the code: ABCD-1234\n",
      ),
    );
    await waitFor(() => f.outputs.some((t) => t.includes("ABCD-1234")));
    const loginLine = f.outputs.find((t) =>
      t.includes("Open https://idp.pushtodisplay.com/device"),
    );
    expect(loginLine).toContain("Code: ABCD-1234");
    expect(loginLine).not.toContain("user_code");

    child.emit("exit", 0);
    await waitFor(() => f.outputs.some((t) => t.includes("Connected")));
    expect(mock.authCalls).toBeGreaterThanOrEqual(2);
    await f.cleanup?.();
  });
});
