import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { assertNextDevRouteWitness } from "../fixtures/next-dev-adopter/verify.ts";
import { createNextArchiveUse } from "./next-dev-archive.ts";
import { assertNextDevWorkerArchiveReceipt, parseNextDevWorkerRequest } from "./next-dev-adopter-smoke.ts";

test("server compiler warm-up requires one rendered exact route witness", () => {
  const witness = '<main data-dev-coherence-root data-dev-edge data-dev-expected-margin="91.875px"></main>';
  expect(() => assertNextDevRouteWitness(witness, "91.875px")).not.toThrow();
  for (const html of ["", `<script>${JSON.stringify(witness)}</script>`, `<!--${witness}-->`,
    `<template>${witness}</template>`, witness + witness, witness.replaceAll("main", "div"),
    witness.replace(" data-dev-coherence-root", ""), witness.replace("91.875px", "92.875px"),
    witness.replace("data-dev-edge", "data-dev-edge-other"), "x".repeat(4 * 1024 * 1024 + 1)]) {
    expect(() => assertNextDevRouteWitness(html, "91.875px")).toThrow();
  }
});

const repository = "/private/tmp/next-protocol-repository";
const evidenceRoot = `${repository}/.stylex-fixtures/next-dev-evidence-test`;
const work = `${repository}/.stylex-fixtures/next-dev-adopter-test`;
const inputPath = `${evidenceRoot}/worker-request.json`;
const archivePath = `${work}/hraness-ui.tgz`;
function archive(ctime = "100") {
  const bytes = Buffer.from("sealed archive");
  return { bytes, seal: { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    identity: ["17", "19", "33188", "1", String(bytes.length), "100", ctime] } };
}
function request() {
  return { schemaVersion: 1 as const, repository, evidenceRoot, work, bunExecutable: "/private/tmp/bun", browserExecutable: "/private/tmp/chrome",
    archiveSeal: archive().seal, packageInputs: [
      { path: "dist/stylex.css", bytes: 12, sha256: "a".repeat(64) },
      { path: "package.json", bytes: 32, sha256: "b".repeat(64) },
    ] };
}

test("worker request parsing is pure and freezes complete producer and package evidence before path access", () => {
  const source = request();
  const parsed = parseNextDevWorkerRequest(inputPath, source);
  expect(parsed).toEqual(source);
  source.archiveSeal.identity[6] = "999";
  source.packageInputs[0]!.sha256 = "c".repeat(64);
  expect(parsed.archiveSeal.identity[6]).toBe("100");
  expect(parsed.packageInputs[0]!.sha256).toBe("a".repeat(64));
  for (const value of [parsed, parsed.archiveSeal, parsed.archiveSeal.identity, parsed.packageInputs, ...parsed.packageInputs]) {
    expect(Object.isFrozen(value)).toBe(true);
  }
});

test("worker request parsing rejects untrusted paths and containment before any filesystem operation", () => {
  for (const key of ["repository", "evidenceRoot", "work", "browserExecutable", "bunExecutable"] as const) {
    for (const path of ["relative", "/private/tmp/../escape", "/private//tmp/duplicate", "/private/tmp/trailing/", "/private/tmp/line\nbreak", "/private/tmp/back\\slash", ""]) {
      expect(() => parseNextDevWorkerRequest(inputPath, { ...request(), [key]: path })).toThrow();
    }
  }
  for (const patch of [
    { repository: "/private/tmp/another" }, { work: "/private/tmp/next-dev-adopter-test" },
    { work: `${repository}/.stylex-fixtures/foreign` }, { evidenceRoot: `${repository}/.stylex-fixtures/foreign` },
    { evidenceRoot: `${work}/next-dev-evidence-nested` },
  ]) expect(() => parseNextDevWorkerRequest(inputPath, { ...request(), ...patch })).toThrow();
  for (const path of ["relative", `${inputPath}/`, `${evidenceRoot}/foreign.json`]) {
    expect(() => parseNextDevWorkerRequest(path, request())).toThrow();
  }
});

test("worker request parsing rejects malformed, unsorted, duplicate or over-bound input manifests", () => {
  const row = request().packageInputs[0]!;
  for (const value of [null, {}, { ...request(), schemaVersion: 2 }, { ...request(), extra: true },
    { ...request(), archiveSeal: { ...archive().seal, identity: archive().seal.identity.slice(0, 6) } }]) {
    expect(() => parseNextDevWorkerRequest(inputPath, value)).toThrow();
  }
  for (const packageInputs of [null, [], [row, row], [...request().packageInputs].reverse(),
    [{ ...row, path: "../package.json" }], [{ ...row, path: "/package.json" }], [{ ...row, path: "./package.json" }],
    [{ ...row, path: "a//b" }], [{ ...row, path: "a/".repeat(33) + "b" }],
    [{ ...row, bytes: -1 }], [{ ...row, bytes: 0.5 }], [{ ...row, bytes: 32 * 1024 * 1024 + 1 }],
    [{ ...row, sha256: "bad" }], [{ ...row, extra: true }], Array.from({ length: 1025 }, () => row),
    Array.from({ length: 9 }, (_, index) => ({ ...row, path: `part-${String(index)}`, bytes: 32 * 1024 * 1024 }))]) {
    expect(() => parseNextDevWorkerRequest(inputPath, { ...request(), packageInputs })).toThrow();
  }
});

test("complete worker receipts require exact serialized admission and a fresh full execution snapshot", async () => {
  const producer = archive(), execution = archive("101");
  const owner = createNextArchiveUse(archivePath, producer.seal, async () => execution);
  const admission = await owner.admit();
  const serialized: unknown = JSON.parse(JSON.stringify(admission));
  const proof = assertNextDevWorkerArchiveReceipt("complete", serialized, archivePath, producer.seal, execution);
  expect(proof).toEqual(admission);
  expect(proof).not.toBe(admission);
  expect(() => assertNextDevWorkerArchiveReceipt("complete", serialized, archivePath, producer.seal)).toThrow();
  expect(() => assertNextDevWorkerArchiveReceipt("complete", null, archivePath, producer.seal, execution)).toThrow();
  for (const snapshot of [producer, archive("102")]) {
    expect(() => assertNextDevWorkerArchiveReceipt("complete", serialized, archivePath, producer.seal, snapshot)).toThrow();
  }
  expect(() => assertNextDevWorkerArchiveReceipt("complete", serialized, `${work}/other.tgz`, producer.seal, execution)).toThrow();
  expect(() => assertNextDevWorkerArchiveReceipt("complete", serialized, archivePath, execution.seal, execution)).toThrow();
});

test("failed and cancelled receipts prove cleanup without requiring an existing or unaltered archive", () => {
  for (const state of ["failed", "cancelled"]) {
    expect(assertNextDevWorkerArchiveReceipt(state, null, archivePath, archive().seal)).toBe(null);
    expect(() => assertNextDevWorkerArchiveReceipt(state, {}, archivePath, archive().seal)).toThrow();
    expect(() => assertNextDevWorkerArchiveReceipt(state, null, archivePath, archive().seal, archive())).toThrow();
  }
  for (const state of [undefined, "pending", "success", 1]) {
    expect(() => assertNextDevWorkerArchiveReceipt(state, null, archivePath, archive().seal)).toThrow();
  }
});
