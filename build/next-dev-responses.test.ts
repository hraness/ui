import { expect, test } from "bun:test";
import { createNextDevConsumerLedger } from "./next-dev-consumers.js";
import { createNextDevResponseHandle, createNextDevResponseRequests, type NextDevResponseClassification } from "./next-dev-responses.js";

// Deterministic commit/request doubles, not React/Flight or browser acceptance.
const hash = (value: number) => value.toString(16).padStart(64, "0");
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture() {
  const ledger = createNextDevConsumerLedger({ consumers: [{ source: "app/page.tsx", target: "server" }], session: "a".repeat(32) });
  const statuses = new Map<number, NextDevResponseClassification["status"]>([[1, "stale"], [2, "unready"], [3, "ready"], [4, "future"]]);
  for (let sequence = 1; sequence <= 4; sequence++) ledger.publish({ sequence, revision: hash(sequence),
    includedRevisions: [hash(sequence)], stylesheetSha256: hash(sequence + 100) });
  const descriptor = (sequence: number) => ledger.descriptor("app/page.tsx", sequence);
  const timers = new Map<number, { callback: () => void; milliseconds: number }>();
  let highestTimer = 0;
  let restarts = 0;
  const owner = createNextDevResponseRequests({
    classify(value, floor) {
      const parsed = ledger.captured(value);
      return { descriptor: parsed, status: parsed.sequence < floor ? "stale" : statuses.get(parsed.sequence)! };
    },
    setTimeout(callback, milliseconds) { const id = ++highestTimer; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout(id) { timers.delete(id); },
    restartRequired() { restarts++; },
  });
  return { owner, descriptor, statuses, timers, restarts: () => restarts };
}

test("render-local handles and read-only classification allocate no request, timer, subscription or refresh", () => {
  const { owner, descriptor, timers } = fixture();
  createNextDevResponseHandle();
  expect(owner.classify(descriptor(1), 0).status).toBe("stale");
  expect(owner.getSnapshot()).toEqual({ phase: "open", pending: 0, refreshEpoch: 0, version: 0 });
  expect(timers.size).toBe(0);
  owner.close();
});

test("one sibling's exact usable commit cannot discharge another first-mount request or extend its deadline", async () => {
  const { owner, descriptor, timers } = fixture();
  const left = createNextDevResponseHandle(); const right = createNextDevResponseHandle();
  let refreshes = 0; owner.bindRefresh(() => { refreshes++; });
  owner.request(left, descriptor(1), 3, () => {});
  owner.request(right, descriptor(1), 3, () => {});
  const originalTimers = [...timers.keys()];
  await tick();
  expect(refreshes).toBe(1);
  owner.request(left, descriptor(3), 3, () => {});
  owner.responseCommitted(left, descriptor(3));
  expect(owner.getSnapshot().pending).toBe(1);
  expect([...timers.keys()]).toEqual([originalTimers[1]!]);
  const before = owner.getSnapshot();
  owner.request(right, descriptor(1), 3, () => {}); await tick();
  expect(refreshes).toBe(1);
  expect(owner.getSnapshot()).toBe(before);
  expect([...timers.keys()]).toEqual([originalTimers[1]!]);
  timers.get(originalTimers[1]!)!.callback();
  expect(owner.getSnapshot().phase).toBe("restart-required");
  expect(timers.size).toBe(0);
  owner.close();
});

test("Strict cleanup/setup preserves the original timer and dispatch identity; real cleanup collects only its request", async () => {
  const { owner, descriptor, timers } = fixture();
  const handle = createNextDevResponseHandle();
  let refreshes = 0; let unbind = owner.bindRefresh(() => { refreshes++; });
  owner.request(handle, descriptor(1), 0, () => {}); await tick();
  const timer = [...timers.keys()][0]!;
  const epoch = owner.getSnapshot().refreshEpoch;
  owner.park(handle); unbind();
  unbind = owner.bindRefresh(() => { refreshes++; });
  owner.request(handle, descriptor(1), 0, () => {}); await tick();
  expect([...timers.keys()]).toEqual([timer]);
  expect(owner.getSnapshot().refreshEpoch).toBe(epoch);
  expect(refreshes).toBe(1);
  owner.park(handle); await tick();
  expect(owner.getSnapshot().pending).toBe(0);
  expect(owner.getSnapshot().refreshEpoch).toBe(0);
  expect(timers.size).toBe(0);
  unbind(); owner.close();
});

test("native authority and CSS readiness can wake a root but only its exact commit clears the obligation", () => {
  const { owner, descriptor, statuses, timers } = fixture();
  const handle = createNextDevResponseHandle(); let wakes = 0;
  owner.request(handle, descriptor(4), 0, () => { wakes++; });
  expect(wakes).toBe(0);
  statuses.set(4, "unready"); owner.changed();
  expect(wakes).toBe(0);
  statuses.set(4, "ready"); owner.changed(); owner.changed();
  expect(wakes).toBe(1);
  expect(owner.getSnapshot().pending).toBe(1);
  expect(timers.size).toBe(1);
  const originalTimer = [...timers.keys()][0]!;
  statuses.set(4, "unready"); owner.changed();
  expect(wakes).toBe(1);
  expect(owner.getSnapshot().pending).toBe(1);
  statuses.set(4, "ready"); owner.changed();
  expect(wakes).toBe(2);
  expect([...timers.keys()]).toEqual([originalTimer]);
  owner.responseCommitted(handle, descriptor(4));
  expect(owner.getSnapshot().pending).toBe(0);
  expect(timers.size).toBe(0);
  owner.close();
});

test("a different ready descriptor, foreign handle or lower committed floor cannot acknowledge an obligation", () => {
  for (const action of ["descriptor", "handle", "floor"] as const) {
    const { owner, descriptor, timers, restarts } = fixture();
    const handle = createNextDevResponseHandle(); owner.request(handle, descriptor(1), 3, () => {});
    if (action === "descriptor") expect(() => owner.responseCommitted(handle, descriptor(3))).toThrow("exact ready request");
    else if (action === "handle") expect(() => owner.responseCommitted(createNextDevResponseHandle(), descriptor(3))).toThrow("live instance");
    else expect(() => owner.request(handle, descriptor(1), 2, () => {})).toThrow("floor backwards");
    expect(owner.getSnapshot().phase).toBe("restart-required");
    expect(restarts()).toBe(1);
    expect(timers.size).toBe(0);
    owner.close();
  }
});

test("retries and newer response props keep the original 15-second deadline", async () => {
  const { owner, descriptor, timers, restarts } = fixture();
  const handle = createNextDevResponseHandle();
  owner.request(handle, descriptor(1), 0, () => {});
  const [id, original] = [...timers.entries()][0]!;
  expect(original.milliseconds).toBe(15_000);
  owner.request(handle, descriptor(4), 0, () => {}); await tick();
  expect([...timers.keys()]).toEqual([id]);
  expect(timers.get(id)).toBe(original);
  original.callback();
  expect(owner.getSnapshot().phase).toBe("restart-required");
  expect(restarts()).toBe(1);
  expect(timers.size).toBe(0);
  owner.close();
});

test("refresh dispatch is marked before reentrancy and late arrivals cannot create a refresh storm", async () => {
  const { owner, descriptor, timers } = fixture();
  const first = createNextDevResponseHandle(); const reentrant = createNextDevResponseHandle(); const late = createNextDevResponseHandle();
  let refreshes = 0;
  owner.bindRefresh(() => { refreshes++; owner.request(reentrant, descriptor(1), 0, () => {}); });
  owner.request(first, descriptor(1), 0, () => {}); await tick();
  owner.request(late, descriptor(1), 0, () => {}); await tick();
  expect(refreshes).toBe(1);
  expect(owner.getSnapshot().pending).toBe(3);
  expect(timers.size).toBe(3);
  owner.close(); expect(timers.size).toBe(0);
});

test("refresh failure becomes owned terminal state with collected timers and no repeated callback", async () => {
  const { owner, descriptor, timers, restarts } = fixture();
  let refreshes = 0; let wakes = 0; let notifications = 0;
  owner.subscribe(() => { notifications++; });
  owner.bindRefresh(() => { refreshes++; throw new Error("failed refresh"); });
  owner.request(createNextDevResponseHandle(), descriptor(1), 0, () => { wakes++; });
  await tick();
  expect(owner.getSnapshot().phase).toBe("restart-required");
  expect(refreshes).toBe(1); expect(wakes).toBe(1); expect(restarts()).toBe(1);
  expect(timers.size).toBe(0);
  const terminalNotifications = notifications;
  owner.changed(); owner.restartRequired(); await tick();
  expect(notifications).toBe(terminalNotifications);
  expect(refreshes).toBe(1);
  owner.close();
});

test("pending committed instances are bounded without allocating anything for abandoned render attempts", () => {
  const { owner, descriptor, timers } = fixture();
  for (let index = 0; index < 128; index++) createNextDevResponseHandle();
  expect(timers.size).toBe(0);
  for (let index = 0; index < 64; index++) owner.request(createNextDevResponseHandle(), descriptor(4), 0, () => {});
  expect(timers.size).toBe(64);
  expect(() => owner.request(createNextDevResponseHandle(), descriptor(4), 0, () => {})).toThrow("response limit");
  expect(owner.getSnapshot().phase).toBe("restart-required");
  expect(timers.size).toBe(0);
  owner.close();
});

test("a throwing observer cannot prevent terminal collection, sibling wakeup or the restart callback", () => {
  for (const failure of ["listener", "wake"] as const) {
    const { owner, descriptor, timers, restarts } = fixture();
    let siblingWakes = 0;
    owner.request(createNextDevResponseHandle(), descriptor(4), 0, () => { throw new Error("bad observer"); });
    owner.request(createNextDevResponseHandle(), descriptor(4), 0, () => { siblingWakes++; });
    if (failure === "listener") { owner.subscribe(() => { throw new Error("bad listener"); }); owner.changed(); }
    else owner.restartRequired();
    expect(owner.getSnapshot().phase).toBe("restart-required");
    expect(siblingWakes).toBe(1);
    expect(restarts()).toBe(1);
    expect(timers.size).toBe(0);
    owner.close();
  }
});
