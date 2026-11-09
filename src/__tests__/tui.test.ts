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
        inboxID: string;
        item: {
          type: string;
          payload: {
            text: string;
            metadata?: Record<string, unknown>;
          };
          delivery: "steer" | "queue";
        };
      };
    }
    const show = jest.fn();
    const alert = jest.fn(async () => {});
    let handler: ((event: TestEvent) => void) | undefined;
    const stop = plugin.setup({
      data: {
        on: (_type: "session.inbox.enqueued", cb: (event: TestEvent) => void) => {
          handler = cb;
          return () => {};
        },
      },
      ui: { toast: { show }, dialog: { alert } },
    });

    handler?.({
      data: {
        sessionID: "s1",
        inboxID: "inbox-1",
        item: {
          type: "synthetic",
          payload: { text: "not ours", metadata: { source: "other" } },
          delivery: "steer",
        },
      },
    });
    expect(show).not.toHaveBeenCalled();

    handler?.({
      data: {
        sessionID: "s1",
        inboxID: "inbox-2",
        item: {
          type: "synthetic",
          payload: { text: "Panel cleared", metadata: { source: "pushtodisplay" } },
          delivery: "steer",
        },
      },
    });
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Panel cleared",
        variant: "success",
        sessionID: "s1",
      }),
    );

    handler?.({
      data: {
        sessionID: "s1",
        inboxID: "inbox-3",
        item: {
          type: "synthetic",
          payload: {
            text: "Open https://idp.example/device in a browser — code: ABCD-1234",
            metadata: { source: "pushtodisplay" },
          },
          delivery: "steer",
        },
      },
    });
    expect(alert).toHaveBeenCalledWith({
      title: "Push To Display login",
      message: "Open https://idp.example/device in a browser — code: ABCD-1234",
    });

    handler?.({
      data: {
        sessionID: "s1",
        inboxID: "inbox-4",
        item: {
          type: "synthetic",
          payload: {
            text: "✅ Connected to Push To Display!",
            metadata: { source: "pushtodisplay", kind: "login" },
          },
          delivery: "steer",
        },
      },
    });
    expect(alert).toHaveBeenLastCalledWith({
      title: "Push To Display login",
      message: "✅ Connected to Push To Display!",
    });

    stop();
  });
});
