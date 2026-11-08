/**
 * Per-session state.
 *
 * Each event becomes its own message (see `messages.ts`), so this module renders
 * nothing. It holds the two facts a message needs: what the agent was asked, and
 * what it last said. Counters used to live here for a session summary; when the
 * summary went, they went with it — a field nothing reads is a bug waiting to
 * happen.
 */

export interface PanelState {
  /** Agent name for the first field of every line. */
  agent: string;
  /** Session working directory, used to shorten paths. */
  cwd: string;
  /** The prompt this agent was asked to work on. */
  task: string;
  /** What the agent said when it finished — the result line's text. */
  closing: string;
}

export interface CreateStateOpts {
  agent: string;
  cwd?: string;
}

export function createState(opts: CreateStateOpts): PanelState {
  return {
    agent: opts.agent,
    cwd: opts.cwd ?? process.cwd(),
    task: "",
    closing: "",
  };
}

/** Reset for a fresh session. */
export function beginSession(s: PanelState): void {
  s.task = "";
  s.closing = "";
}

/** A new prompt arrived; an empty prompt keeps the existing task. */
export function beginTask(s: PanelState, prompt: string): void {
  // Kept raw: `messages.ts` shortens paths, and trimming here would cut a path
  // before it could be shortened — which is how `…/pasted-imag…` happened.
  if (prompt) s.task = prompt;
  s.closing = "";
}

/**
 * Keep what the agent actually said, so the result line can report it.
 *
 * The last text block wins (the earlier ones are usually "let me check…"), and
 * code fences are dropped — the board is not a terminal.
 */
export function noteAssistant(s: PanelState, message: unknown): void {
  const m = message as { role?: string; content?: unknown } | null;
  if (!m || m.role !== "assistant") return;
  const content = m.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    for (let i = content.length - 1; i >= 0; i--) {
      const block = content[i] as { type?: string; text?: unknown } | null;
      if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
        text = block.text;
        break;
      }
    }
  }
  noteText(s, text);
}

/**
 * Keep a raw assistant text block. OpenCode reports finished text parts as
 * `session.text.ended` events, so the extension can call this directly instead
 * of reconstructing a whole assistant message.
 */
export function noteText(s: PanelState, text: string): void {
  text = (text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .split("\n")
    // A heading is a label, not a result: drop the line rather than keep "Summary".
    .filter((line) => !/^\s{0,3}#{1,6}\s/.test(line))
    .join(" ")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text) s.closing = text;
}
