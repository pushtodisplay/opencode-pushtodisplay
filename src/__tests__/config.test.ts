import { clock, loadConfig, num, truncate } from "../config.ts";

describe("loadConfig", () => {
  it("uses safe defaults", () => {
    expect(loadConfig({})).toEqual({
      boardId: "",
      panel: 1,
      label: "",
      disabled: false,
      steps: true,
    });
  });

  it("reads the documented environment variables", () => {
    expect(
      loadConfig({
        PUSHTODISPLAY_BOARD_ID: "board-1",
        PUSHTODISPLAY_PANEL: "3",
        PUSHTODISPLAY_LABEL: "release",
        PUSHTODISPLAY_DISABLED: "1",
        PUSHTODISPLAY_STEPS: "0",
      }),
    ).toEqual({
      boardId: "board-1",
      panel: 3,
      label: "release",
      disabled: true,
      steps: false,
    });
  });

  it("lets plugin options override the environment", () => {
    expect(
      loadConfig(
        {
          PUSHTODISPLAY_BOARD_ID: "env-board",
          PUSHTODISPLAY_PANEL: "2",
          PUSHTODISPLAY_LABEL: "env-label",
          PUSHTODISPLAY_DISABLED: "1",
          PUSHTODISPLAY_STEPS: "0",
        },
        {
          boardId: "option-board",
          panel: 4,
          label: "option-label",
          disabled: false,
          steps: true,
        },
      ),
    ).toEqual({
      boardId: "option-board",
      panel: 4,
      label: "option-label",
      disabled: false,
      steps: true,
    });
  });

  it("accepts boolean options and env-style option keys", () => {
    expect(
      loadConfig({}, { PUSHTODISPLAY_STEPS: false, PUSHTODISPLAY_DISABLED: true }),
    ).toMatchObject({ steps: false, disabled: true });
    expect(loadConfig({}, { steps: "0", disabled: "1" })).toMatchObject({
      steps: false,
      disabled: true,
    });
  });

  it("falls back to panel 1 for out-of-range or non-integer values", () => {
    expect(loadConfig({ PUSHTODISPLAY_PANEL: "0" }).panel).toBe(1);
    expect(loadConfig({ PUSHTODISPLAY_PANEL: "5" }).panel).toBe(1);
    expect(loadConfig({ PUSHTODISPLAY_PANEL: "2.5" }).panel).toBe(1);
    expect(loadConfig({ PUSHTODISPLAY_PANEL: "nope" }).panel).toBe(1);
  });

  it("treats only explicit false-ish step values as off", () => {
    expect(loadConfig({ PUSHTODISPLAY_STEPS: "1" }).steps).toBe(true);
    expect(loadConfig({ PUSHTODISPLAY_STEPS: "false" }).steps).toBe(false);
    expect(loadConfig({ PUSHTODISPLAY_STEPS: "yes" }).steps).toBe(true);
  });
});

describe("num", () => {
  it("clamps to the panel range", () => {
    expect(num(1, 9)).toBe(1);
    expect(num(4, 9)).toBe(4);
    expect(num(0, 9)).toBe(9);
    expect(num(5, 9)).toBe(9);
    expect(num("3", 9)).toBe(3);
  });
});

describe("truncate", () => {
  it("keeps short text whole", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  it("prefers a word boundary", () => {
    expect(truncate("the quick brown fox jumps", 16)).toBe("the quick brown…");
  });

  it("hard-cuts a single long token", () => {
    expect(truncate("a".repeat(30), 10)).toBe("aaaaaaaaa…");
  });

  it("collapses whitespace", () => {
    expect(truncate("  a\n\t b  ", 20)).toBe("a b");
  });
});

describe("clock", () => {
  it("returns HH:MM:SS", () => {
    expect(clock()).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
