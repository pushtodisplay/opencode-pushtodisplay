/**
 * TUI part of opencode-pushtodisplay.
 *
 * The server part writes command output as synthetic inbox messages with
 * `resume: false`, so it never starts a model turn. Those messages are not
 * rendered until the session runs again, so this part mirrors them as TUI
 * toasts on admission: immediate feedback without an assistant response.
 */
const SOURCE = "pushtodisplay";

type ToastVariant = "info" | "success" | "warning" | "error";

interface InboxEnqueuedEvent {
  data: {
    sessionID: string;
    inboxID: string;
    item: {
      type: string;
      payload?: {
        text?: string;
        description?: string;
        metadata?: Record<string, unknown>;
      };
      delivery?: "steer" | "queue";
    };
  };
}

interface TuiContext {
  data: {
    on(type: "session.inbox.enqueued", handler: (event: InboxEnqueuedEvent) => void): () => void;
  };
  ui: {
    toast: {
      show(options: {
        title?: string;
        message: string;
        variant?: ToastVariant;
        duration?: number;
        sessionID?: string;
      }): void;
    };
    dialog: {
      alert(options: { title?: string; message: string }): Promise<void>;
    };
  };
}

export function toastVariant(text: string): ToastVariant {
  if (text.includes("✅") || /^(Test update sent|Panel cleared)$/.test(text)) return "success";
  if (text.includes("⚠️")) return "warning";
  if (/\b(failed|could not|not found|not authenticated)\b/i.test(text)) return "error";
  return "info";
}

export default {
  id: "pushtodisplay.tui",
  setup(context: TuiContext): () => void {
    return context.data.on("session.inbox.enqueued", (event) => {
      const item = event.data.item;
      if (item.type !== "synthetic") return;
      if (item.payload?.metadata?.source !== SOURCE) return;
      const text = item.payload.text;
      if (!text) return;
      // Login output contains the verification link, device code, and the
      // final result. A toast is too transient for that; keep it in a dialog
      // until dismissed.
      if (item.payload.metadata?.kind === "login" || /https?:\/\//.test(text)) {
        void context.ui.dialog
          .alert({ title: "Push To Display login", message: text })
          .catch(() => {});
        return;
      }
      context.ui.toast.show({
        title: "Push To Display",
        message: text,
        variant: toastVariant(text),
        duration: 8_000,
        sessionID: event.data.sessionID,
      });
    });
  },
};
