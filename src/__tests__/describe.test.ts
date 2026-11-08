import {
  cleanCommand,
  describeTool,
  shortenPath,
  tidyText,
  MAX_DESC,
} from "../describe.ts";

const CWD = "/repo";

describe("shortenPath", () => {
  it("makes a path inside the cwd relative", () => {
    expect(shortenPath("/repo/src/a.ts", { cwd: CWD })).toBe("src/a.ts");
  });

  it("shortens $HOME to ~", () => {
    expect(shortenPath("/home/me/proj/a.ts", { home: "/home/me" })).toBe("~/proj/a.ts");
  });

  it("keeps only the file name for an unrelated absolute path", () => {
    expect(shortenPath("/tmp/other/a.ts", { cwd: CWD, home: "/home/me" })).toBe("…/a.ts");
  });

  it("leaves a relative path alone", () => {
    expect(shortenPath("src/a.ts", { cwd: CWD })).toBe("src/a.ts");
  });
});

describe("tidyText", () => {
  it("shortens path-looking words but not prose or URLs", () => {
    expect(tidyText("look at /repo/src/a.ts and https://example.com/a.ts", { cwd: CWD })).toBe(
      "look at src/a.ts and https://example.com/a.ts",
    );
  });
});

describe("cleanCommand", () => {
  it("drops a leading cd guard and env assignments", () => {
    expect(cleanCommand("cd /repo && FOO=1 npm test")).toBe("npm test");
  });

  it("drops a pipe to head or tail and redirections", () => {
    expect(cleanCommand("npm test | head -20")).toBe("npm test");
    expect(cleanCommand("npm test 2>&1")).toBe("npm test");
    expect(cleanCommand("npm test > /tmp/out")).toBe("npm test");
  });

  it("uses the first non-empty line", () => {
    expect(cleanCommand("\n  \n  ls -1 src\n")).toBe("ls -1 src");
  });
});

describe("describeTool — OpenCode built-ins", () => {
  it("describes bash with the cleaned command", () => {
    expect(
      describeTool("bash", { command: "cd /repo && npm test | head -20" }, { cwd: CWD }),
    ).toBe("running npm test");
  });

  it("summarises a long command to its program and subcommand", () => {
    expect(
      describeTool("bash", { command: 'grep -rn "amber|BG_|ON_DARK" src/*.ts index.ts' }, { cwd: CWD }),
    ).toBe("running grep");
  });

  it("describes read/write/edit with filePath", () => {
    expect(describeTool("read", { filePath: "/repo/src/a.ts" }, { cwd: CWD })).toBe(
      "reading src/a.ts",
    );
    expect(
      describeTool("write", { filePath: "/repo/src/a.ts", content: "a\nb\nc" }, { cwd: CWD }),
    ).toBe("writing src/a.ts");
    expect(
      describeTool(
        "edit",
        {
          filePath: "/repo/src/a.ts",
          oldString: "a\nb",
          newString: "a\nb\nc",
        },
        { cwd: CWD },
      ),
    ).toBe("editing src/a.ts (+3 −2)");
  });

  it("keeps the extension when a file name must be abbreviated", () => {
    const name = "a-very-long-file-name-that-does-not-fit-in-the-budget.ts";
    const shown = describeTool("read", { filePath: `/repo/${name}` }, { cwd: CWD });
    expect(shown.startsWith("reading ")).toBe(true);
    expect(shown.endsWith(".ts")).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(MAX_DESC);
  });

  it("describes grep, glob and list", () => {
    expect(
      describeTool("grep", { pattern: "TODO", path: "/repo/src" }, { cwd: CWD }),
    ).toBe("searching for TODO in src");
    expect(describeTool("glob", { pattern: "**/*.test.ts" }, { cwd: CWD })).toBe(
      "finding **/*.test.ts",
    );
    expect(describeTool("list", { path: "/repo/src" }, { cwd: CWD })).toBe("listing src");
  });

  it("describes webfetch and websearch", () => {
    expect(describeTool("webfetch", { url: "https://example.com/docs" })).toBe(
      "fetching example.com/docs",
    );
    expect(describeTool("websearch", { query: "opencode plugins" })).toBe(
      "searching the web for opencode plugins",
    );
  });

  it("describes task delegation", () => {
    expect(describeTool("task", { description: "Review auth" })).toBe(
      "delegating: Review auth",
    );
    expect(describeTool("task", { prompt: "Review auth" })).toBe("delegating: Review auth");
    expect(describeTool("task", {})).toBe("delegating to a subagent");
  });

  it("describes plan and patch tools", () => {
    expect(describeTool("todowrite", { todos: [] })).toBe("updating the plan");
    expect(describeTool("todoread", {})).toBe("updating the plan");
    expect(describeTool("patch", { patchText: "..." })).toBe("applying a patch");
  });

  it("falls back to the tool name and its arguments", () => {
    expect(describeTool("custom_tool", {})).toBe("custom_tool");
    expect(describeTool("custom_tool", { foo: "bar" })).toBe("custom_tool(foo: bar)");
  });

  it("never exceeds the description budget", () => {
    const shown = describeTool(
      "bash",
      { command: "x".repeat(200) },
      { cwd: CWD },
    );
    expect(shown.length).toBeLessThanOrEqual(MAX_DESC);
  });
});
