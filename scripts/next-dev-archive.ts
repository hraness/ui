import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { snapshotNextFile } from "./next-dev-inputs.ts";

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type ArchiveSnapshot = Awaited<ReturnType<typeof snapshotNextFile>>;
type ArchiveReader = (path: string, maxBytes: number) => Promise<ArchiveSnapshot>;
type ArchiveState = "fresh" | "admitting" | "active" | "checking" | "failed";
export type NextArchiveSeal = Readonly<{ bytes: number; sha256: string; identity: readonly string[] }>;
export type NextArchiveAdmissionEvidence = Readonly<{
  path: string;
  producerSeal: NextArchiveSeal;
  executionSeal: NextArchiveSeal;
}>;

function pathValue(path: unknown): asserts path is string {
  assert(typeof path === "string" && path.length > 0 && path.length <= 4096
    && !/[\x00-\x1f\\]/u.test(path) && isAbsolute(path) && resolve(path) === path,
  "Archive path must be exact, absolute and canonical");
}

/** Copy only ordinary data properties. Neither getters nor caller-owned nested
 * objects become authority inside the archive-use closure. */
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  assert(typeof value === "object" && value !== null && !Array.isArray(value));
  assert(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  assert.deepEqual(Reflect.ownKeys(value).sort(), [...names].sort(), "Unexpected archive evidence fields");
  const result: Record<string, unknown> = {};
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    assert(descriptor !== undefined && "value" in descriptor, "Archive evidence accessors are forbidden");
    result[name] = descriptor.value;
  }
  return result;
}

export function parseNextArchiveSeal(value: unknown): NextArchiveSeal {
  const record = fields(value, ["bytes", "sha256", "identity"]);
  assert(typeof record.bytes === "number" && Number.isSafeInteger(record.bytes)
    && record.bytes > 0 && record.bytes <= MAX_ARCHIVE_BYTES, "Invalid archive byte bound");
  assert(typeof record.sha256 === "string" && /^[a-f0-9]{64}$/u.test(record.sha256), "Invalid archive digest");
  const array = record.identity;
  assert(Array.isArray(array) && array.length === 7, "Archive identity requires the full seven fields");
  assert.deepEqual(Reflect.ownKeys(array).sort(), ["0", "1", "2", "3", "4", "5", "6", "length"]);
  const identity = Array.from({ length: 7 }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(array, String(index));
    assert(descriptor !== undefined && "value" in descriptor);
    const field: unknown = descriptor.value;
    assert(typeof field === "string" && /^(?:0|[1-9][0-9]{0,31})$/u.test(field), "Invalid archive identity field");
    return field;
  });
  // snapshotNextFile orders dev, ino, mode, nlink, size, mtimeNs, ctimeNs.
  assert.equal(identity[4], String(record.bytes), "Archive size identity disagrees with byte count");
  assert((BigInt(identity[2]!) & 0o170000n) === 0o100000n && BigInt(identity[3]!) > 0n,
    "Archive identity must describe an ordinary linked file");
  return Object.freeze({ bytes: record.bytes, sha256: record.sha256, identity: Object.freeze(identity) });
}

function snapshotValue(value: ArchiveSnapshot): { seal: NextArchiveSeal; bytes: Buffer } {
  const record = fields(value, ["bytes", "seal"]);
  assert(record.bytes instanceof Uint8Array && record.bytes.byteLength <= MAX_ARCHIVE_BYTES);
  // Retain a private independent byte copy; mutable Buffer views are never
  // published as frozen evidence or retained from an injected test reader.
  const bytes = Buffer.from(record.bytes);
  const seal = parseNextArchiveSeal(record.seal);
  assert.equal(bytes.byteLength, seal.bytes, "Archive snapshot byte count changed");
  assert.equal(hash(bytes), seal.sha256, "Archive snapshot digest does not bind its bytes");
  return { seal, bytes };
}

function assertProducerContent(producer: NextArchiveSeal, execution: NextArchiveSeal): void {
  assert.equal(execution.bytes, producer.bytes, "Archive bytes differ from the immutable producer seal");
  assert.equal(execution.sha256, producer.sha256, "Archive content differs from the immutable producer seal");
  assert.deepEqual(execution.identity.slice(0, 6), producer.identity.slice(0, 6),
    "Only pre-admission ctime may differ from the immutable producer seal");
}

/** Verify serialized evidence after collection against a fresh strict snapshot.
 * This pure proof check does not issue an archive-use object, register authority,
 * permit another admission, or explain the cause of a ctime transition. */
export function assertNextArchiveAdmissionEvidence(
  value: unknown, path: string, producerSeal: unknown, currentSnapshot: ArchiveSnapshot,
): NextArchiveAdmissionEvidence {
  pathValue(path);
  const record = fields(value, ["path", "producerSeal", "executionSeal"]);
  assert.equal(record.path, path, "Archive evidence belongs to another exact path");
  const producer = parseNextArchiveSeal(producerSeal), recordedProducer = parseNextArchiveSeal(record.producerSeal);
  const execution = parseNextArchiveSeal(record.executionSeal), current = snapshotValue(currentSnapshot);
  assert.deepEqual(recordedProducer, producer, "Archive evidence changed its immutable producer seal");
  assertProducerContent(producer, execution);
  assert.deepEqual(current.seal, execution, "Archive changed after its single execution admission");
  return Object.freeze({ path, producerSeal: recordedProducer, executionSeal: execution });
}

/** One Node-use admission for one exact producer-sealed archive. The default
 * reader remains strict over all seven FD/path fields within every snapshot.
 * Only the boundary before the first use permits a ctime difference. */
export function createNextArchiveUse(path: string, producerSeal: unknown, snapshot: ArchiveReader = snapshotNextFile) {
  pathValue(path);
  const producer = parseNextArchiveSeal(producerSeal);
  let state: ArchiveState = "fresh";
  let issued: NextArchiveAdmissionEvidence | undefined;
  let executionBytes: Buffer | undefined;
  let failure: unknown;
  const fail = (error: unknown): never => {
    if (state !== "failed") { state = "failed"; failure = error; }
    throw failure;
  };
  const requireState = (expected: ArchiveState): void => {
    if (state === "failed") throw failure;
    if (state !== expected) fail(new Error("Archive use permits one admission and serialized checks only"));
  };
  return Object.freeze({
    async admit(): Promise<NextArchiveAdmissionEvidence> {
      requireState("fresh");
      state = "admitting";
      try {
        const current = snapshotValue(await snapshot(path, MAX_ARCHIVE_BYTES));
        requireState("admitting");
        assertProducerContent(producer, current.seal);
        executionBytes = current.bytes;
        issued = Object.freeze({ path, producerSeal: producer, executionSeal: current.seal });
        state = "active";
        return issued;
      } catch (error) { return fail(error); }
    },
    async assertUnchanged(admission: unknown): Promise<void> {
      requireState("active");
      state = "checking";
      try {
        assert(issued !== undefined && admission === issued,
          "Archive use requires its exact closure-issued object, never copied or serialized evidence");
        const current = snapshotValue(await snapshot(path, MAX_ARCHIVE_BYTES));
        requireState("checking");
        assert.deepEqual(current.seal, issued.executionSeal, "Archive full identity changed after admission");
        assert(executionBytes !== undefined && current.bytes.equals(executionBytes), "Archive bytes changed after admission");
        state = "active";
      } catch (error) { fail(error); }
    },
  });
}
