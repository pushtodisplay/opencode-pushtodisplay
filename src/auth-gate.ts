/**
 * Auth gate for outgoing messages.
 *
 * The rule is "never send while logged out", which sounds simple until you
 * consider the first seconds of a session: auth has not been checked *yet*, and
 * a naive `if (!authed) return` silently discards everything a fast turn
 * produces — a "test" prompt answered without tools produced nothing at all
 * because both its task line and its result line were dropped while the probe
 * was still running.
 *
 * So the states are distinct:
 *
 *   unknown  → wait for the probe, then send
 *   authed   → send
 *   known-bad → don't send, and don't re-ask more often than `intervalMs`
 */
export class AuthGate {
  private authed = false;
  private probing: Promise<boolean> | null = null;
  private lastProbeAt = 0;

  constructor(
    private readonly probe: () => Promise<boolean>,
    private readonly intervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get authenticated(): boolean {
    return this.authed;
  }

  /** Start a probe now. Used on session start and after login. */
  start(): Promise<boolean> {
    return this.run();
  }

  /**
   * May a message go out? Resolves true when it may. While a probe is in flight
   * this waits for it rather than answering "no" — that is the whole point.
   */
  async allowed(): Promise<boolean> {
    if (this.authed) return true;
    if (this.probing) return this.probing;
    if (this.now() - this.lastProbeAt >= this.intervalMs) return this.run();
    return false;
  }

  /** A send failed on auth: stop sending until a probe succeeds again. */
  revoke(): void {
    this.authed = false;
  }

  /** Probe again, ignoring the interval (e.g. `/pushtodisplay-status`). */
  recheck(): Promise<boolean> {
    this.lastProbeAt = 0;
    return this.run();
  }

  private run(): Promise<boolean> {
    if (!this.probing) {
      this.lastProbeAt = this.now();
      this.probing = this.probe()
        .then((ok) => {
          this.authed = ok;
          return ok;
        })
        .finally(() => {
          this.probing = null;
        });
    }
    return this.probing;
  }
}
