/**
 * The one queue between an event and the board.
 *
 * A panel is a scrolling history, so entries are a trail: they must be sent in
 * the order they happened, and a result must never be buried behind a pile of
 * steps. Sends are also rate-limited — every call costs a message from the
 * monthly quota and Sandbox tiers cap around 1 msg/s.
 *
 *  - **Order is the information.** Nothing is ever reordered.
 *  - **Bounded backlog.** Past `maxPending`, the oldest non-urgent entry is
 *    dropped: a trail that lags minutes behind the agent is worse than a
 *    shorter one.
 *  - **Consecutive duplicates are suppressed** at enqueue time, so `A, B, A`
 *    still posts both `A`s.
 *  - **Spacing is measured from the end of the previous send**, which is the
 *    conservative reading of "1 msg/s" (a slow CLI cannot compress the gap).
 */
import type { Payload } from "./payloads.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fingerprint of what a person would actually see. */
function fingerprint(p: Payload): string {
  return JSON.stringify([
    p.background ?? "",
    p.blocks.map((b) => [b.text, b.color ?? ""]),
  ]);
}

interface Entry {
  payload: Payload;
  /** Milestones and results survive backlog trimming; steps do not. */
  urgent: boolean;
}

export class Sender {
  private queue: Entry[] = [];
  private draining: Promise<void> | null = null;
  private lastSentAt = 0;
  private lastKey = "";

  constructor(
    private readonly send: (payload: Payload) => Promise<void>,
    private readonly intervalMs: number,
    private readonly maxPending: number,
    private readonly onError: (err: unknown) => void = () => {},
  ) {}

  /**
   * Add an entry. `urgent` marks a milestone or result — it is sent in order
   * like anything else, but it survives backlog trimming.
   */
  enqueue(payload: Payload, opts: { urgent?: boolean } = {}): void {
    const key = fingerprint(payload);
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.queue.push({ payload, urgent: Boolean(opts.urgent) });

    while (this.queue.length > this.maxPending) {
      const victim = this.queue.findIndex((entry) => !entry.urgent);
      if (victim === -1) break;
      this.queue.splice(victim, 1);
    }
    this.start();
  }

  /** Resolve once everything queued so far has been attempted. */
  async flush(): Promise<void> {
    for (;;) {
      if (this.queue.length > 0 && !this.draining) this.start();
      if (!this.draining) return;
      await this.draining;
    }
  }

  private start(): void {
    if (this.draining) return;
    this.draining = (async () => {
      try {
        for (let entry = this.queue.shift(); entry; entry = this.queue.shift()) {
          const wait = Math.max(0, this.intervalMs - (Date.now() - this.lastSentAt));
          if (wait > 0) await sleep(wait);
          try {
            await this.send(entry.payload);
          } catch (err) {
            this.onError(err);
          } finally {
            this.lastSentAt = Date.now();
          }
        }
      } finally {
        this.draining = null;
      }
    })();
  }
}
