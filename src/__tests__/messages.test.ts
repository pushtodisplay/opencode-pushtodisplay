import {
  taskMessage,
  stepMessage,
  doneMessage,
  blockedMessage,
  permissionBody,
  permissionMessage,
  stoppedMessage,
  errorDetail,
  errorMessage,
  sessionOpenedMessage,
  sessionClosedMessage,
  renamedMessage,
  testMessage,
  clearedMessage,
  type Status,
} from "../messages.ts";
import { ACCENT, STATUS_COLOR, SURFACE, TEXT, TEXT_DIM, type Payload } from "../payloads.ts";

/** The status colour a payload actually used, whatever its status was. */
const someStatusColor = (p: Payload) =>
  p.blocks[2]?.color !== undefined &&
  (Object.values(STATUS_COLOR) as string[]).includes(p.blocks[2].color)
    ? p.blocks[2].color
    : "unknown";

const WALL = "11:04:22";
const AGENT = "release";

const text = (p: Payload) => p.blocks.map((b) => b.text).join("");

const build = {
  opened: sessionOpenedMessage({ panelId: 1, agent: AGENT, wall: WALL }),
  closed: sessionClosedMessage({ panelId: 1, agent: AGENT, wall: WALL }),
  renamed: renamedMessage({ panelId: 1, agent: AGENT, wall: WALL }),
  task: taskMessage({ panelId: 1, agent: AGENT, wall: WALL, task: "fix the flaky test" }),
  stepOk: stepMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    toolName: "bash",
    args: { command: "npm test" },
    cwd: "/repo",
    ok: true,
  }),
  stepFailed: stepMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    toolName: "bash",
    args: { command: "npm test" },
    cwd: "/repo",
    ok: false,
  }),
  done: doneMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    text: "Pinned the clock so the release test is deterministic. No other changes.",
  }),
  blocked: blockedMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    kind: "confirm",
    title: "Allow bash?",
  }),
  permission: permissionMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    action: "bash",
    resources: ["git push --force-with-lease"],
  }),
  stopped: stoppedMessage({ panelId: 1, agent: AGENT, wall: WALL }),
  error: errorMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    detail: "provider returned 500",
  }),
  test: testMessage({ panelId: 1, agent: AGENT, wall: WALL }),
  cleared: clearedMessage({ panelId: 1, agent: AGENT, wall: WALL }),
};

describe("one shape for every message", () => {
  it.each(Object.entries(build))("%s reads: agent, event, STATUS, time", (_name, p) => {
    const shown = text(p);
    expect(shown.startsWith(`${AGENT} `)).toBe(true);
    expect(shown).toMatch(new RegExp(` [A-Z]+ ${"11:04"}$`));
    expect(p.blocks).toHaveLength(4);
  });

  it.each(Object.entries(build))("%s is four inline runs on one surface", (_name, p) => {
    const shown = text(p);
    expect(shown).not.toContain("·");
    expect(p.background).toBe(SURFACE);
    expect(/[🎯▸◐✓✕🏁✅◌•]/u.test(shown)).toBe(false);
    // Colour is the only thing that varies; size and weight are the renderer's
    // defaults and are never set.
    for (const block of p.blocks) {
      expect(Object.keys(block).sort()).toEqual(["color", "text"]);
    }
  });

  it.each(Object.entries(build))("%s colours name, body, status and time apart", (_name, p) => {
    expect(p.blocks.map((b) => b.color)).toEqual([
      ACCENT,
      TEXT,
      someStatusColor(p),
      TEXT_DIM,
    ]);
  });

  it("uses only the closed status vocabulary", () => {
    const allowed: Status[] = ["ready", "run", "ok", "fail", "needs", "done", "stop", "ended"];
    for (const p of Object.values(build)) {
      const words = allowed.map((s) => s.toUpperCase());
      expect(words.some((w) => text(p).includes(` ${w} `))).toBe(true);
    }
  });
});

describe("session lifecycle", () => {
  it("brackets a session without reporting any counters", () => {
    expect(text(build.opened)).toBe("release session opened READY 11:04");
    expect(text(build.closed)).toBe("release session closed ENDED 11:04");
    expect(text(build.renamed)).toBe("release session renamed READY 11:04");
  });
});

describe("bodies", () => {
  it("the task line states the prompt and that it is running", () => {
    expect(text(build.task)).toBe("release fix the flaky test RUN 11:04");
  });

  it("a step reports its outcome", () => {
    expect(text(build.stepOk)).toBe("release running npm test OK 11:04");
    expect(text(build.stepFailed)).toBe("release running npm test FAIL 11:04");
  });

  it("a blocking prompt is the question, not a category", () => {
    expect(text(build.blocked)).toBe("release Allow bash? NEEDS 11:04");
  });

  it("a permission line names the action and the resource", () => {
    expect(text(build.permission)).toBe(
      "release Allow bash: git push --force-with-lease NEEDS 11:04",
    );
  });

  it("a titleless prompt still reads as English", () => {
    const p = blockedMessage({ panelId: 1, agent: AGENT, wall: WALL, kind: "select" });
    expect(text(p)).toBe("release waiting for you to choose NEEDS 11:04");
  });

  it("done quotes what the agent said, not counters", () => {
    expect(text(build.done)).toBe(
      "release Pinned the clock so the release test is deterministic. DONE 11:04",
    );
  });

  it("falls back when the agent produced no text", () => {
    expect(text(doneMessage({ panelId: 1, agent: AGENT, wall: WALL, text: "  " }))).toBe(
      "release no summary DONE 11:04",
    );
  });

  it("a stopped run says so", () => {
    expect(text(build.stopped)).toBe("release interrupted before it finished STOP 11:04");
  });

  it("a provider error says what the provider said", () => {
    expect(text(build.error)).toBe("release provider returned 500 FAIL 11:04");
    expect(
      text(errorMessage({ panelId: 1, agent: AGENT, wall: WALL, detail: "  " })),
    ).toBe("release the model call failed FAIL 11:04");
  });

  it("a test and a clear line say what they are", () => {
    expect(text(build.test)).toBe("release link OK, panel 1 OK 11:04");
    expect(text(build.cleared)).toBe("release log cleared OK 11:04");
  });
});

describe("permission bodies", () => {
  it("shortens a path against the session cwd", () => {
    expect(permissionBody("edit", ["/repo/src/auth.ts"], "/repo")).toBe(
      "Allow edit: src/auth.ts",
    );
  });

  it("counts extra resources instead of listing them", () => {
    expect(permissionBody("bash", ["git push", "git tag", "git log"], "/repo")).toBe(
      "Allow bash: git push +2",
    );
  });

  it("uses the familiar tool name for OpenCode's shell action", () => {
    expect(permissionBody("shell", ["git push --force-with-lease"], "/repo")).toBe(
      "Allow bash: git push --force-with-lease",
    );
  });

  it("prefers a human-readable message when the server supplies one", () => {
    const p = permissionMessage({
      panelId: 1,
      agent: AGENT,
      wall: WALL,
      action: "bash",
      resources: ["rm -rf build"],
      message: "Allow bash: rm -rf build?",
    });
    expect(text(p)).toBe("release Allow bash: rm -rf build? NEEDS 11:04");
  });

  it("falls back when there is no action or resource", () => {
    expect(permissionBody("", [])).toBe("waiting for your permission");
  });
});

describe("error details", () => {
  it("uses the provider message", () => {
    expect(errorDetail({ message: "HTTP 500 upstream timed out" })).toBe(
      "HTTP 500 upstream timed out",
    );
  });

  it("adds a status only when the message does not already name it", () => {
    expect(errorDetail({ message: "upstream timed out", status: 502 })).toBe(
      "HTTP 502 upstream timed out",
    );
    expect(errorDetail({ message: "HTTP 500 upstream", status: 500 })).toBe(
      "HTTP 500 upstream",
    );
  });

  it("falls back to the type or response body", () => {
    expect(errorDetail({ type: "provider.invalid-request" })).toBe(
      "provider.invalid-request",
    );
    expect(errorDetail({ response: { body: "bad request" } })).toBe("bad request");
  });
});

describe("body budgets", () => {
  const LONG = "opencode-pushtodisplay";

  it("shortens a long prompt the same way it shortens a result", () => {
    const prompt =
      "Refactor the auth middleware so that every request resolves its session once, " +
      "and add a regression test for the double-resolve bug we saw in production. " +
      "Then tell me what changed.";
    const p = taskMessage({ panelId: 1, agent: LONG, wall: WALL, task: prompt });
    const body = p.blocks[1]?.text.trim() ?? "";
    expect(body.length).toBeLessThanOrEqual(60);
    expect(body.startsWith("Refactor the auth middleware")).toBe(true);
    expect(body.endsWith("…")).toBe(true);
    expect(text(p)).not.toContain("Then tell me what changed");
  });

  it("keeps a prompt that fits, whole", () => {
    const p = taskMessage({
      panelId: 1,
      agent: LONG,
      wall: WALL,
      task: "Run the tests. Then summarise.",
    });
    expect(text(p)).toBe(`${LONG} Run the tests. RUN 11:04`);
  });

  it("shortens a tool description but never the result", () => {
    const p = stepMessage({
      panelId: 1,
      agent: LONG,
      wall: WALL,
      toolName: "bash",
      args: { command: 'grep -rn "amber|BG_|ON_DARK" src/*.ts index.ts' },
      cwd: "/repo",
      ok: true,
    });
    expect(text(p)).toBe(`${LONG} running grep OK 11:04`);

    const result = doneMessage({
      panelId: 1,
      agent: LONG,
      wall: WALL,
      text: "All 112 tests pass and the board now quotes this sentence.",
    });
    expect(text(result)).toBe(
      `${LONG} All 112 tests pass and the board now quotes this sentence. DONE 11:04`,
    );
  });

  it("shortens a long answer to its first sentence", () => {
    const long =
      "Refactored the middleware so each request resolves its session once. " +
      "Added a regression test. Also fixed three unrelated typos in the docs.";
    const p = doneMessage({ panelId: 1, agent: AGENT, wall: WALL, text: long });
    expect(text(p)).toBe(
      "release Refactored the middleware so each request resolves its… DONE 11:04",
    );
  });

  it("a sentence that is still too long ends at a word, with an ellipsis", () => {
    const p = doneMessage({
      panelId: 1,
      agent: AGENT,
      wall: WALL,
      text: "word ".repeat(60) + "end.",
    });
    const shown = text(p);
    expect(shown).not.toContain("wor…");
    expect(shown.length).toBeLessThan(140);
  });

  it("collapses a multi-line provider error into one sentence", () => {
    const p = errorMessage({
      panelId: 1,
      agent: AGENT,
      wall: WALL,
      detail: "HTTP 500\n  upstream\ttimed out",
    });
    expect(text(p)).toBe("release HTTP 500 upstream timed out FAIL 11:04");
  });
});
