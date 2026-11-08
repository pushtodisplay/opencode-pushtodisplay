import { AuthGate } from "../auth-gate.ts";

/** A probe whose answer we control, and that we can leave pending. */
function controllable() {
  let resolve!: (v: boolean) => void;
  let started = 0;
  const probe = () => {
    started += 1;
    return new Promise<boolean>((r) => {
      resolve = r;
    });
  };
  return {
    probe,
    get started() {
      return started;
    },
    answer: (v: boolean) => resolve(v),
  };
}

describe("AuthGate", () => {
  it("waits for an in-flight probe instead of dropping the message", async () => {
    const p = controllable();
    const gate = new AuthGate(p.probe, 20_000);

    void gate.start(); // startup probe, still running
    const permitted = gate.allowed(); // a fast turn wants to send right now

    let decided = false;
    void permitted.then(() => (decided = true));
    await Promise.resolve();
    expect(decided).toBe(false); // it waited rather than answering "no"

    p.answer(true);
    await expect(permitted).resolves.toBe(true);
    expect(gate.authenticated).toBe(true);
  });

  it("sends immediately once authenticated, without asking again", async () => {
    const p = controllable();
    const gate = new AuthGate(p.probe, 20_000);
    void gate.start();
    p.answer(true);
    await gate.start();

    await expect(gate.allowed()).resolves.toBe(true);
    expect(p.started).toBe(1);
  });

  it("says no when a probe already failed, and does not re-ask within the interval", async () => {
    let now = 1_000;
    const p = controllable();
    const gate = new AuthGate(p.probe, 20_000, () => now);

    void gate.start();
    p.answer(false);
    await gate.start();
    expect(gate.authenticated).toBe(false);

    await expect(gate.allowed()).resolves.toBe(false);
    expect(p.started).toBe(1);

    now += 25_000; // interval elapsed: ask again
    const retry = gate.allowed();
    expect(p.started).toBe(2);
    p.answer(true);
    await expect(retry).resolves.toBe(true);
  });

  it("stops sending after an auth failure until a probe succeeds", async () => {
    const p = controllable();
    const gate = new AuthGate(p.probe, 20_000, () => 0);
    void gate.start();
    p.answer(true);
    await gate.start();
    expect(gate.authenticated).toBe(true);

    gate.revoke();
    await expect(gate.allowed()).resolves.toBe(false);

    const recheck = gate.recheck();
    p.answer(true);
    await expect(recheck).resolves.toBe(true);
    expect(gate.authenticated).toBe(true);
  });
});
