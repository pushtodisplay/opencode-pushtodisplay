import plugin, { toastVariant } from "../tui.ts";

describe("TUI part", () => {
  it("registers a TUI plugin id", () => {
    expect(plugin.id).toBe("pushtodisplay.tui");
    expect(typeof plugin.setup).toBe("function");
  });

  it("maps command output to toast variants", () => {
    expect(toastVariant("✅ Push To Display authenticated")).toBe("success");
    expect(toastVariant("⚠️ Not authenticated — run /pushtodisplay-login first")).toBe("warning");
    expect(toastVariant("Test update failed — see log")).toBe("error");
    expect(toastVariant("Starting Push To Display OAuth login…")).toBe("info");
  });

  it("only mirrors pushtodisplay synthetic messages", () => {
    interface TestEvent {
      data: {
        sessionID: string;
        text: string;
        metadata?: Record<string, unknown>;
      };
    }
    const show = jest.fn();
    let handler: ((event: TestEvent) => void) | undefined;
    const stop = plugin.setup({
      data: {
        on: (_type: "session.synthetic", cb: (event: TestEvent) => void) => {
          handler = cb;
          return () => {};
        },
      },
      ui: { toast: { show } },
    });

    handler?.({
      data: { sessionID: "s1", text: "not ours", metadata: { source: "other" } },
    });
    expect(show).not.toHaveBeenCalled();

    handler?.({
      data: { sessionID: "s1", text: "Panel cleared", metadata: { source: "pushtodisplay" } },
    });
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Panel cleared",
        variant: "success",
        sessionID: "s1",
      }),
    );

    stop();
  });
});
