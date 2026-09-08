import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { assertNextArchiveAdmissionEvidence, createNextArchiveUse } from "./next-dev-archive.ts";

const path = "/private/tmp/next-adopter/hraness-ui.tgz";
function snapshot(content = "sealed archive", ctime = "100") {
  const bytes = Buffer.from(content);
  return { bytes, seal: { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    identity: ["17", "19", "33188", "1", String(bytes.length), "100", ctime] } };
}
function fixture(current = snapshot(undefined, "101")) {
  let value = current;
  const calls: unknown[] = [];
  const producer = snapshot();
  const owner = createNextArchiveUse(path, producer.seal, async (actual, maximum) => {
    calls.push([actual, maximum]);
    return value;
  });
  return { owner, producer, calls, set(next: ReturnType<typeof snapshot>) { value = next; } };
}
async function failure(promise: Promise<unknown>): Promise<unknown> {
  const result = await promise.then(() => ({ ok: true as const }), error => ({ ok: false as const, error: error as unknown }));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected a failed archive operation");
  return result.error;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

test("one admission preserves the producer seal and permits only pre-admission ctime metadata differences", async () => {
  for (const ctime of ["99", "100", "101"]) {
    const item = fixture(snapshot(undefined, ctime));
    const admission = await item.owner.admit();
    expect(admission.path).toBe(path);
    expect(admission.producerSeal).toEqual(item.producer.seal);
    expect(admission.executionSeal).toEqual(snapshot(undefined, ctime).seal);
    expect(admission.producerSeal.identity[6]).toBe("100");
    await item.owner.assertUnchanged(admission);
    expect(item.calls).toEqual([[path, 32 * 1024 * 1024], [path, 32 * 1024 * 1024]]);
  }
});

test("every non-ctime producer identity field and every content or hash change rejects admission without retry", async () => {
  const changed = ["18", "20", "33152", "2", "15", "101"].map((field, index) => {
    const current = index === 4 ? snapshot("sealed archive!", "101") : snapshot(undefined, "101");
    current.seal.identity[index] = field;
    return current;
  });
  changed.push(snapshot("alterd archive", "101"));
  const wrongHash = snapshot(undefined, "101"); wrongHash.seal.sha256 = "a".repeat(64); changed.push(wrongHash);
  const wrongBytes = snapshot(undefined, "101"); wrongBytes.bytes[0] = 0; changed.push(wrongBytes);
  const wrongCount = snapshot(undefined, "101"); wrongCount.seal.bytes += 1; changed.push(wrongCount);
  for (const current of changed) {
    const item = fixture(current);
    const first = await failure(item.owner.admit());
    item.set(snapshot());
    expect(await failure(item.owner.admit())).toBe(first);
    expect(item.calls).toHaveLength(1);
  }
});

test("the strict reader owns all internal FD/path identity checks and its failures are never relaxed", async () => {
  for (const phase of ["opened descriptor", "final descriptor", "final path"]) {
    const error = new Error(`Strict seven-field identity changed at ${phase}`);
    let calls = 0;
    const owner = createNextArchiveUse(path, snapshot().seal, async () => { calls++; throw error; });
    expect(await failure(owner.admit())).toBe(error);
    expect(await failure(owner.admit())).toBe(error);
    expect(calls).toBe(1);
  }
});

test("every post-admission identity drift, including ctime, is fatal even after exact restoration", async () => {
  const changes = ["18", "20", "33152", "2", "15", "101", "102"].map((field, index) => {
    const current = index === 4 ? snapshot("sealed archive!", "101") : snapshot(undefined, "101");
    current.seal.identity[index] = field;
    return current;
  });
  changes.push(snapshot("alterd archive", "101"));
  for (const changed of changes) {
    const item = fixture();
    const admission = await item.owner.admit();
    item.set(changed);
    const first = await failure(item.owner.assertUnchanged(admission));
    item.set(snapshot(undefined, "101"));
    expect(await failure(item.owner.assertUnchanged(admission))).toBe(first);
    expect(await failure(item.owner.admit())).toBe(first);
    expect(item.calls).toHaveLength(2);
  }
});

test("reader failures after admission remain fatal without accepting a later restored snapshot", async () => {
  const error = new Error("Strict snapshot rejected a mid-read ctime change");
  let calls = 0;
  const owner = createNextArchiveUse(path, snapshot().seal, async () => {
    calls++;
    if (calls === 2) throw error;
    return snapshot(undefined, "101");
  });
  const admission = await owner.admit();
  expect(await failure(owner.assertUnchanged(admission))).toBe(error);
  expect(await failure(owner.assertUnchanged(admission))).toBe(error);
  expect(calls).toBe(2);
});

test("a second admission cannot mint another authority or clear a prior successful admission", async () => {
  const item = fixture(), admission = await item.owner.admit();
  const error = await failure(item.owner.admit());
  expect(await failure(item.owner.assertUnchanged(admission))).toBe(error);
  expect(item.calls).toHaveLength(1);
});

test("concurrent admission or checks poison the owner without overlapping another read", async () => {
  const gate = deferred<ReturnType<typeof snapshot>>();
  let calls = 0;
  const owner = createNextArchiveUse(path, snapshot().seal, async () => { calls++; return gate.promise; });
  const first = failure(owner.admit());
  const error = await failure(owner.admit());
  gate.resolve(snapshot(undefined, "101"));
  expect(await first).toBe(error);
  expect(calls).toBe(1);

  const check = deferred<ReturnType<typeof snapshot>>();
  let checkCalls = 0;
  const admitted = createNextArchiveUse(path, snapshot().seal, async () => {
    checkCalls++;
    return checkCalls === 1 ? snapshot(undefined, "101") : check.promise;
  });
  const token = await admitted.admit();
  const pending = failure(admitted.assertUnchanged(token));
  const checkError = await failure(admitted.assertUnchanged(token));
  check.resolve(snapshot(undefined, "101"));
  expect(await pending).toBe(checkError);
  expect(checkCalls).toBe(2);
});

test("closure authority rejects copied, foreign, serialized and separately validated evidence objects", async () => {
  for (const kind of ["copy", "foreign", "serialized", "validated", "wrong-path"]) {
    const item = fixture(), admission = await item.owner.admit();
    const other = kind === "foreign" ? await fixture().owner.admit()
      : kind === "serialized" ? JSON.parse(JSON.stringify(admission)) as unknown
      : kind === "validated" ? assertNextArchiveAdmissionEvidence(JSON.parse(JSON.stringify(admission)), path, item.producer.seal, snapshot(undefined, "101"))
      : { ...admission, ...(kind === "wrong-path" ? { path: "/private/tmp/other.tgz" } : {}) };
    const error = await failure(item.owner.assertUnchanged(other));
    expect(await failure(item.owner.assertUnchanged(admission))).toBe(error);
    expect(item.calls).toHaveLength(1);
  }
});

test("producer input mutations and mutable snapshot buffers cannot rewrite frozen evidence or private authority", async () => {
  const item = fixture(), original = snapshot();
  item.producer.seal.sha256 = "b".repeat(64);
  item.producer.seal.identity[0] = "999";
  item.producer.seal.bytes = 1;
  const admission = await item.owner.admit();
  expect(admission.producerSeal).toEqual(original.seal);
  for (const value of [item.owner, admission, admission.producerSeal, admission.producerSeal.identity,
    admission.executionSeal, admission.executionSeal.identity]) expect(Object.isFrozen(value)).toBe(true);
  expect(Reflect.set(admission, "path", "/private/tmp/other.tgz")).toBe(false);
  expect(Reflect.set(admission.executionSeal.identity, "6", "999")).toBe(false);
  expect(Reflect.set(item.owner, "admit", () => admission)).toBe(false);
  await item.owner.assertUnchanged(admission);

  const mutable = snapshot(undefined, "101"), source = fixture(mutable);
  const token = await source.owner.admit();
  mutable.bytes[0] = 0;
  mutable.seal.identity[6] = "999";
  source.set(snapshot(undefined, "101"));
  await source.owner.assertUnchanged(token);
  expect(token.executionSeal).toEqual(snapshot(undefined, "101").seal);
});

test("parent validation accepts exact serialized proof as frozen data and requires full execution identity thereafter", async () => {
  const item = fixture(), admission = await item.owner.admit();
  const serialized: unknown = JSON.parse(JSON.stringify(admission));
  const proof = assertNextArchiveAdmissionEvidence(serialized, path, snapshot().seal, snapshot(undefined, "101"));
  expect(proof).toEqual(admission);
  expect(proof).not.toBe(admission);
  for (const value of [proof, proof.producerSeal, proof.producerSeal.identity, proof.executionSeal, proof.executionSeal.identity]) expect(Object.isFrozen(value)).toBe(true);
  for (const changed of [snapshot(undefined, "102"), snapshot("alterd archive", "101"), snapshot("sealed archive!", "101")]) {
    expect(() => assertNextArchiveAdmissionEvidence(serialized, path, snapshot().seal, changed)).toThrow();
  }
  for (const patch of [{ path: "/private/tmp/other.tgz" }, { extra: true }, { producerSeal: snapshot(undefined, "99").seal },
    { executionSeal: { ...admission.executionSeal, identity: ["999", ...admission.executionSeal.identity.slice(1)] } },
    { executionSeal: { ...admission.executionSeal, sha256: "a".repeat(64) } }]) {
    expect(() => assertNextArchiveAdmissionEvidence({ ...admission, ...patch }, path, snapshot().seal, snapshot(undefined, "101"))).toThrow();
  }
});

test("admission bounds canonical paths, exact plain fields, complete identities and ordinary file evidence", () => {
  for (const invalid of ["relative.tgz", "/private/tmp/../archive.tgz", "/private//tmp/archive.tgz", "/private/tmp/archive.tgz/", "/private/tmp/archive\n.tgz"]) {
    expect(() => createNextArchiveUse(invalid, snapshot().seal)).toThrow();
  }
  const seal = snapshot().seal;
  for (const value of [null, {}, { ...seal, extra: true }, { ...seal, bytes: 0 }, { ...seal, bytes: 32 * 1024 * 1024 + 1 },
    { ...seal, sha256: "bad" }, { ...seal, identity: seal.identity.slice(0, 6) },
    { ...seal, identity: ["17", "19", "0", ...seal.identity.slice(3)] },
    { ...seal, identity: ["17", "19", "33188", "0", ...seal.identity.slice(4)] },
    { ...seal, identity: ["17", "19", "33188", "1", "9", ...seal.identity.slice(5)] },
    { ...seal, identity: ["-1", ...seal.identity.slice(1)] }]) {
    expect(() => createNextArchiveUse(path, value)).toThrow();
  }
  let called = false;
  const accessor = { ...seal, get sha256() { called = true; return seal.sha256; } };
  expect(() => createNextArchiveUse(path, accessor)).toThrow();
  expect(called).toBe(false);
});
