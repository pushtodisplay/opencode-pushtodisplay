/**
 * Wire types for the Push To Display API, plus the palette.
 *
 * IMPORTANT rendering model (see the frontend's `DisplayBlocks.tsx`):
 * `blocks` are **inline runs**, like `<span>` — not lines, like `<p>`. The
 * blocks of one message flow in order as one paragraph and wrap at the panel
 * width. Separate lines are separate *messages*, which the panel shows as a
 * scrollable history.
 */

/**
 * One inline run. Only `text` and `color` are ever set: size and weight are
 * omitted because the renderer defaults them to `medium` / `regular`, which is
 * exactly what every line uses — an explicit default is just a lie waiting to
 * drift.
 */
export interface Block {
  text: string;
  color?: string;
}

export interface Payload {
  panelId: number;
  background?: string;
  density?: "compact" | "standard" | "spacious";
  blocks: Block[];
}

/**
 * The palette.
 *
 * Colours are chosen against *our own surface*, not against the page: the board
 * may be in a light or a dark theme and the plugin cannot detect which. A
 * near-black card carries its own contrast — it reads as a card on white and as
 * a lifted tile on black — so every foreground keeps its ratio in both.
 */
export const SURFACE = "#1b2430";

/** Body text. */
export const TEXT = "#f2f6f9";

/** Agent name — the one colour that repeats down the left edge. */
export const ACCENT = "#5ec8d4";

/** Time. Dimmest thing on the line, but still above 4.5:1 on the surface. */
export const TEXT_DIM = "#808c99";

/**
 * Status words, coloured by *category* rather than by identity: blue means the
 * agent is up, green a step or run worked, amber it wants you, red something
 * failed, grey nothing is happening. Words distinguish; colour groups.
 */
export const STATUS_COLOR = {
  ready: "#8ab4f8",
  run: "#8ab4f8",
  ok: "#4ade80",
  done: "#4ade80",
  fail: "#ff7b72",
  needs: "#f5b942",
  stop: "#9aa4b0",
  ended: "#9aa4b0",
} as const;
