/**
 * TUI part of opencode-pushtodisplay.
 *
 * The server part writes command output as synthetic messages with
 * `resume: false`, so it never starts a model turn. Those messages are not
 * rendered until the session runs again, so this part mirrors the same
 * messages as TUI toasts: immediate feedback without an assistant response.
 */
const SOURCE = "pushtodisplay";

type ToastVariant = "info" | "success" | "warning" | "error";

interface SynthesisEvent {
  data: {
    sessionID: string;
    text: string;
    metadata?: Record<string, unknown>;
  };
}

interface TuiContext {
  data: {
    on(type: "session.synthetic", handler: (event: SynthesisEvent) => void): () => void;
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
    return context.data.on("session.synthetic", (event) => {
      if (event.data.metadata?.source !== SOURCE) return;
      const text = event.data.text;
      if (!text) return;
      context.ui.toast.show({
        title: "Push To Display",
        message: text,
        variant: toastVariant(text),
        duration: /https?:\/\//.test(text) ? 20_000 : 8_000,
        sessionID: event.data.sessionID,
      });
    });
  },
};
