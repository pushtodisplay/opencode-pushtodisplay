import { Sender } from "../sender.ts";
import type { Payload } from "../payloads.ts";

const msg = (text: string): Payload => ({ panelId: 1, blocks: [{ text }] });

/** Collect sends, remembering when each one happened. */
function recorder() {
  const sent: string[] = [];
  const at: number[] = [];
  const send = async (p: Payload) => {
    sent.push(p.blocks.map((b) => b.text).join(""));
    at.push(Date.now());
  };
  return { sent, at, send };
}

const NO_INTERVAL = 0;
const NO_BOUND = 1_000;
const ignore = () => {};

describe("Sender", () => {
  it("sends entries in the order they happened", async () => {
    const { sent, send } = recorder();
    const s = new Sender(send, NO_INTERVAL, NO_BOUND, ignore);
    s.enqueue(msg("a"));
    s.enqueue(msg("b"));
    s.enqueue(msg("c"));
    await s.flush();
    expect(sent).toEqual(["a", "b", "c"]);
  });

  it("suppresses consecutive duplicates, but not a repeat after another entry", async () => {
    const { sent, send } = recorder();
    const s = new Sender(send, NO_INTERVAL, NO_BOUND, ignore);
    s.enqueue(msg("same"));
    s.enqueue(msg("same"));
    s.enqueue(msg("other"));
    s.enqueue(msg("same"));
    await s.flush();
    expect(sent).toEqual(["same", "other", "same"]);
  });

  it("does not collapse identical lines from different agents", async () => {
    const { sent, send } = recorder();
    const s = new Sender(send, NO_INTERVAL, NO_BOUND, ignore);
    s.enqueue(msg("release running npm test OK 11:04"));
    s.enqueue(msg("qa running npm test OK 11:04"));
    await s.flush();
    expect(sent).toHaveLength(2);
  });

  it("bounds the backlog by dropping the oldest steps, never results", async () => {
    const { sent, send } = recorder();
    const s = new Sender(send, NO_INTERVAL, 3, ignore);
    s.enqueue(msg("RESULT"), { urgent: true });
    for (let i = 0; i < 10; i++) s.enqueue(msg(`step ${i}`));
    await s.flush();
    expect(sent.length).toBeLessThanOrEqual(4);
    expect(sent).toContain("RESULT");
    expect(sent).not.toContain("step 0");
    expect(sent.at(-1)).toBe("step 9");
  });

  it("spaces sends at least the configured interval apart", async () => {
    const { sent, at, send } = recorder();
    const s = new Sender(send, 60, NO_BOUND, ignore);
    s.enqueue(msg("a"));
    s.enqueue(msg("b"));
    await s.flush();
    expect(sent).toEqual(["a", "b"]);
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(55);
  });

  it("keeps going after a failed send and reports it once", async () => {
    const sent: string[] = [];
    const errors: unknown[] = [];
    let calls = 0;
    const s = new Sender(
      async (p) => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        sent.push(p.blocks[0]?.text ?? "");
      },
      NO_INTERVAL,
      NO_BOUND,
      (e) => errors.push(e),
    );
    s.enqueue(msg("a"));
    s.enqueue(msg("b"));
    await s.flush();
    expect(sent).toEqual(["b"]);
    expect(errors).toHaveLength(1);
  });

  it("drains everything queued while a flush is in progress", async () => {
    const { sent, send } = recorder();
    const s = new Sender(send, 20, NO_BOUND, ignore);
    s.enqueue(msg("a"));
    const flushed = s.flush();
    s.enqueue(msg("b"));
    s.enqueue(msg("c"));
    await flushed;
    await s.flush();
    expect(sent).toEqual(["a", "b", "c"]);
    expect(sent).toHaveLength(3);
  });
});
