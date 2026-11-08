/**
 * Configuration for the opencode-pushtodisplay plugin.
 *
 * Settings come from environment variables, so each OpenCode process (or each
 * agent in a multi-agent setup) can write to a different panel without a
 * per-session config file. Plugin options from `opencode.json(c)` override the
 * environment:
 *
 *   PUSHTODISPLAY_BOARD_ID   Send to a specific board (default: your default board)
 *   PUSHTODISPLAY_PANEL      (1-4) which panel this agent writes to (default 1)
 *   PUSHTODISPLAY_LABEL      agent name shown on its panel (default: session name, then folder)
 *   PUSHTODISPLAY_DISABLED   Set to "1" to disable the plugin entirely
 *   PUSHTODISPLAY_STEPS      Set to "0" to post milestones only, not each tool call
 */

export const MAX_PANEL = 4;
export const MIN_PANEL = 1;

export interface Config {
  /** Board ID to send to; empty string means "use the default board". */
  boardId: string;
  /** Which panel (1-4) this agent writes to. */
  panel: number;
  /** Friendly agent name shown on the panel (e.g. "Alice", "cicd"). */
  label: string;
  /** When true, the plugin does nothing. */
  disabled: boolean;
  /** When true, every finished tool call is posted as its own log entry. */
  steps: boolean;
}

/** The object form of a `plugins` entry in opencode.json(c). */
export type ConfigOptions = Record<string, unknown>;

/** Parse an integer between MIN_PANEL and MAX_PANEL, falling back to `dflt`. */
export function num(v: unknown, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n >= MIN_PANEL && n <= MAX_PANEL ? n : dflt;
}

/** Normalize whitespace and enforce a max length, appending an ellipsis. */
export function truncate(s: string, n: number): string {
  const clean = (s ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= n) return clean;
  const cut = clean.slice(0, n - 1);
  const space = cut.lastIndexOf(" ");
  // Prefer a word boundary; fall back to a hard cut for single long tokens
  // (a path, a hash) where cutting mid-token is the least bad option.
  const body = space > n * 0.6 ? cut.slice(0, space) : cut;
  return body.trimEnd() + "…";
}

/** Current wall-clock time as HH:MM:SS. */
export function clock(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
}

/** First value that is neither `undefined` nor `null`. */
function first<T>(...values: T[]): T | undefined {
  return values.find((v) => v !== undefined && v !== null);
}

/** Boolean-ish plugin options: true/"1"/"true"/"yes" vs false/"0"/"false"/"no". */
function flag(value: unknown, dflt: boolean): boolean {
  if (value === undefined || value === null) return dflt;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return dflt;
}

/** Read the plugin config from the environment plus plugin options. Pure. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, options: ConfigOptions = {}): Config {
  return {
    boardId: String(
      first(
        options.boardId,
        options.boardID,
        options["PUSHTODISPLAY_BOARD_ID"],
        env.PUSHTODISPLAY_BOARD_ID,
      ) ?? "",
    ),
    panel: num(
      first(options.panel, options["PUSHTODISPLAY_PANEL"], env.PUSHTODISPLAY_PANEL),
      1,
    ),
    label: String(
      first(options.label, options["PUSHTODISPLAY_LABEL"], env.PUSHTODISPLAY_LABEL) ?? "",
    ),
    disabled: flag(
      first(options.disabled, options["PUSHTODISPLAY_DISABLED"], env.PUSHTODISPLAY_DISABLED),
      false,
    ),
    steps: flag(
      first(options.steps, options["PUSHTODISPLAY_STEPS"], env.PUSHTODISPLAY_STEPS),
      true,
    ),
  };
}
