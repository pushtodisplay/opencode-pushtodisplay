import {
  beginSession,
  beginTask,
  createState,
  noteAssistant,
  noteText,
} from "../panel-state.ts";

describe("panel state", () => {
  it("starts empty", () => {
    const s = createState({ agent: "release", cwd: "/repo" });
    expect(s).toEqual({ agent: "release", cwd: "/repo", task: "", closing: "" });
  });

  it("resets on a fresh session", () => {
    const s = createState({ agent: "release", cwd: "/repo" });
    s.task = "old";
    s.closing = "old result";
    beginSession(s);
    expect(s.task).toBe("");
    expect(s.closing).toBe("");
  });

  it("keeps the existing task when a prompt is empty", () => {
    const s = createState({ agent: "release", cwd: "/repo" });
    beginTask(s, "first");
    beginTask(s, "");
    expect(s.task).toBe("first");
  });

  it("clears the closing text when a new task starts", () => {
    const s = createState({ agent: "release", cwd: "/repo" });
    s.closing = "done";
    beginTask(s, "next");
    expect(s.closing).toBe("");
  });

  it("keeps the last assistant text block", () => {
    const s = createState({ agent: "release", cwd: "/repo" });
    noteAssistant(s, {
      role: "assistant",
      content: [
        { type: "text", text: "Let me check." },
        { type: "text", text: "All tests pass." },
      ],
    });
    expect(s.closing).toBe("All tests pass.");
  });

  it("strips code fences, headings and markdown punctuation", () => {
    const s = createState({ agent: "release", cwd: "/repo" });
    noteAssistant(s, {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "## Summary\n\n```ts\nconst x = 1;\n```\n**Done** with `it`.",
        },
      ],
    });
    expect(s.closing).toBe("Done with it.");
  });

  it("ignores non-assistant messages", () => {
    const s = createState({ agent: "release", cwd: "/repo" });
    noteAssistant(s, { role: "user", content: "hello" });
    expect(s.closing).toBe("");
  });

  it("noteText keeps the latest non-empty text", () => {
    const s = createState({ agent: "release", cwd: "/repo" });
    noteText(s, "first");
    noteText(s, "second");
    noteText(s, "   ");
    expect(s.closing).toBe("second");
  });
});
