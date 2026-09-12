/** Private serial compiler/loader owner. This is not a production receipt. */
import assert from "node:assert/strict";
import { parseAsync, types as t } from "@babel/core";
import { canonicalJson, sha256 } from "./compiler.js";
import { createNextDevConsumerLedger, type NextDevConsumerSource } from "./next-dev-consumers.js";
import { stampNextDevConsumerSource } from "./next-dev-markers.js";
import { installNextDevNativeCompilation, type NextDevNativeCompilation, type NextDevNativeWebpack } from "./next-dev-native-plugin.js";
import { validateNextDevNativeProfile } from "./next-dev-profile.js";
import { createNextDevNativeProducer, type NextDevProducerCandidate } from "./next-dev-producer.js";
import {
  auditNextDevCss, createNextDevRevisionCoordinator, loadNextDevModule, nextDevLogicalPath,
  requireNextDevSnapshot, type NextDevCompilerTarget, type NextDevPreparation, type NextDevSnapshot,
} from "./next-dev-session.js";

type ModuleOutput = Awaited<ReturnType<typeof loadNextDevModule>>;
type NativeOwner = ReturnType<typeof installNextDevNativeCompilation>;
type Producer = ReturnType<typeof createNextDevNativeProducer>;
export type NextDevCompilationContext = Readonly<{
  preparation: NextDevPreparation;
  loadNextDevModule(path: string, source: string | Uint8Array, map?: unknown): Promise<ModuleOutput>;
  auditNextDevCss(path: string, source: string | Uint8Array): Promise<string>;
}>;
type Record = {
  candidate: NextDevProducerCandidate | null;
  context: NextDevCompilationContext;
  error: Error | null;
  native: NativeOwner | null;
  raw: NextDevPreparation;
  target: NextDevCompilerTarget;
};

/** Derive identities from authored bytes, never the compiler target visiting them. */
export async function captureNextDevConsumerRegistry(snapshot: NextDevSnapshot): Promise<readonly NextDevConsumerSource[]> {
  const consumers: NextDevConsumerSource[] = [];
  assert.ok(snapshot.sources.length > 0 && snapshot.sources.length <= 4096, "Next development requires its bounded captured source census");
  for (const source of snapshot.sources) {
    assert.deepEqual(source.map.sources, [source.logicalPath], "Next development consumer registry requires its exact source map");
    const authored = source.map.sourcesContent?.[0];
    assert.ok(source.map.sourcesContent?.length === 1 && typeof authored === "string" && sha256(authored) === source.sourceSha256,
      "Next development consumer registry requires exact authored source bytes");
    const ast = await parseAsync(authored, { babelrc: false, configFile: false, filename: source.logicalPath,
      sourceType: "module", parserOpts: { plugins: ["typescript", "jsx"] } });
    assert.ok(ast != null && t.isFile(ast), "Next development consumer registry could not parse its authored module");
    if (source.logicalPath === "app/layout.tsx") continue;
    const client = ast.program.directives.some(({ value }) => value.value === "use client");
    const defaultExport = ast.program.body.some((statement) => t.isExportDefaultDeclaration(statement));
    if (!defaultExport && !client) continue; // The complete profile still proves these modules are data-only.
    assert.ok(defaultExport, "Next development client modules require one registered default render boundary");
    if (client) { consumers.push({ source: source.logicalPath, target: "client" }); continue; }
    assert.match(source.logicalPath, /^app\/(?:[a-zA-Z0-9_-]+\/)*page\.(?:ts|tsx|js|jsx|mjs|mts|cjs|cts)$/u,
      "Next development server consumers must be static App Router pages");
    const runtimes = ast.program.body.flatMap((statement) => t.isExportNamedDeclaration(statement) && t.isVariableDeclaration(statement.declaration)
      ? statement.declaration.declarations.filter((entry) => t.isIdentifier(entry.id, { name: "runtime" })) : []);
    assert.ok(runtimes.length <= 1, "Next development page has multiple runtime declarations");
    const runtime = runtimes[0]?.init;
    assert.ok(runtime === undefined || t.isStringLiteral(runtime) && ["edge", "nodejs"].includes(runtime.value),
      "Next development page runtime must be an exact static Node or Edge literal");
    consumers.push({ source: source.logicalPath, target: t.isStringLiteral(runtime, { value: "edge" }) ? "edge-server" : "server" });
  }
  consumers.sort((left, right) => left.source < right.source ? -1 : left.source > right.source ? 1 : 0);
  await validateNextDevNativeProfile(snapshot.sources, consumers);
  // Prove every root, including unopened routes, before freezing the registry.
  // This local descriptor is only an AST probe; none of its output is emitted.
  const probe = createNextDevConsumerLedger({ consumers, session: "0".repeat(32) });
  try {
    probe.publish({ sequence: 1, revision: snapshot.revision, includedRevisions: snapshot.includedRevisions, stylesheetSha256: "0".repeat(64) });
    for (const consumer of consumers) {
      const source = snapshot.sources.find(({ logicalPath }) => logicalPath === consumer.source);
      assert.ok(source !== undefined);
      await stampNextDevConsumerSource(source, probe.descriptor(consumer.source, 1));
    }
  } finally { probe.close(); }
  return Object.freeze(consumers.map((consumer) => Object.freeze(consumer)));
}

/**
 * Next's client, Node and Edge compilers share this one owner. Preparation is
 * not publication: only the real client hook's terminal asset census can make
 * a descriptor available to a later server compilation. Framework-only passes
 * retire their own candidate without publishing or requesting a client build.
 */
export function createNextDevCompilationOwner(session: Readonly<{ prepare(): Promise<NextDevPreparation> }>) {
  const coordinator = createNextDevRevisionCoordinator(session);
  const contexts = new WeakMap<NextDevCompilationContext, Record>();
  let registry: readonly NextDevConsumerSource[] | null = null;
  let producer: Producer | null = null;
  let active: Record | null = null;
  let preparing = false;
  const captured = (context: NextDevCompilationContext): Record => {
    const record = contexts.get(context);
    assert.ok(record !== undefined && record === active, "Next development compilation is foreign, terminal or not the active serial owner");
    return record;
  };
  const validate = (record: Record, relevant: boolean): Error | null => {
    const coherence = coordinator.validate(record.target, record.raw, relevant);
    return relevant ? record.error ?? coherence : null;
  };
  const admit = (record: Record): NextDevSnapshot => {
    captured(record.context);
    const error = validate(record, true);
    if (error !== null) throw error;
    assert.ok(record.candidate !== null && producer !== null, "Next development loader has no captured native CSS authority");
    return requireNextDevSnapshot(record.raw);
  };
  const finish = (record: Record, relevant: boolean, succeeded: boolean): void => {
    let producerSettled = false;
    let coordinatorSettled = false;
    try {
      const error = validate(record, relevant);
      if (succeeded && error !== null) throw error;
      if (record.target === "client" && record.candidate !== null) {
        assert.ok(producer !== null);
        if (relevant && succeeded) {
          assert.ok(record.native !== null, "Next development client omitted its native publication hooks");
          producer.complete(record.candidate, true, record.native.terminalAssets());
        } else producer.complete(record.candidate, false);
        producerSettled = true;
      }
      coordinatorSettled = true;
      coordinator.complete(record.target, record.raw, relevant, succeeded);
    } catch (error) {
      // Preserve failed/aborted source watches and last-good publication. Never
      // leave a prepared producer candidate poisoning the next compilation.
      const errors: unknown[] = [error];
      if (record.target === "client" && record.candidate !== null && !producerSettled) {
        try { producer!.complete(record.candidate, false); } catch (cleanup) { errors.push(cleanup); }
      }
      if (!coordinatorSettled) {
        try { coordinator.complete(record.target, record.raw, relevant, false); } catch (cleanup) { errors.push(cleanup); }
      }
      throw errors.length === 1 ? error : new AggregateError(errors, "Next development compilation and terminal collection failed");
    } finally { active = null; }
  };
  return Object.freeze({
    registerClientInvalidator: coordinator.registerClientInvalidator,
    async prepare(target: NextDevCompilerTarget): Promise<NextDevCompilationContext> {
      assert.ok(!preparing && active === null, "Next development requires terminal collection before another serial compiler starts");
      preparing = true;
      try {
        const raw = await coordinator.prepare(target);
        let error = raw.error;
        let candidate: NextDevProducerCandidate | null = null;
        const stamped = new Map<string, ModuleOutput>();
        if (raw.snapshot !== null && error === null) {
          try {
            const nextRegistry = await captureNextDevConsumerRegistry(raw.snapshot);
            if (registry !== null) assert.equal(canonicalJson(nextRegistry), canonicalJson(registry),
              "Next development consumer source/target registry changed; restart next dev");
            if (producer === null) {
              producer = createNextDevNativeProducer({ consumers: nextRegistry });
              registry = nextRegistry;
            }
            candidate = target === "client" ? await producer.prepare(raw.snapshot) : producer.published(raw.snapshot);
            for (const consumer of registry!) {
              const source = raw.snapshot.sources.find(({ logicalPath }) => logicalPath === consumer.source);
              assert.ok(source !== undefined);
              stamped.set(consumer.source, await stampNextDevConsumerSource(source, producer.descriptor(candidate, consumer.source, consumer.target)));
            }
          } catch (cause) {
            error = cause instanceof Error ? cause : new Error(String(cause));
            if (target === "client" && candidate !== null) producer!.complete(candidate, false);
            candidate = null;
          }
        }
        const preparation = error === raw.error ? raw : Object.freeze({ ...raw, error });
        let record: Record;
        const context: NextDevCompilationContext = Object.freeze({
          preparation,
          async loadNextDevModule(path: string, source: string | Uint8Array, map?: unknown) {
            const snapshot = admit(record);
            const logical = nextDevLogicalPath(snapshot.rootDirectory, path);
            const original = await loadNextDevModule(raw, path, source, map);
            admit(record); // An aborted asynchronous loader cannot return late source authority.
            const consumer = registry!.find(({ source }) => source === logical);
            if (consumer === undefined) return original;
            assert.ok(consumer.target === "client" || consumer.target === target,
              "Next development consumer was visited by a different native compiler target");
            const result = stamped.get(logical);
            assert.ok(result !== undefined, "Next development consumer is missing its captured descriptor/map");
            return result;
          },
          async auditNextDevCss(path: string, source: string | Uint8Array) {
            const snapshot = admit(record);
            const audited = await auditNextDevCss(raw, path, source);
            admit(record);
            // The native link owner is now the sole presentation authority.
            // Keeping a union in Next's ordinary CSS stream would reintroduce
            // the old independent stylesheet/JavaScript delivery race.
            return path === snapshot.cssEntry ? "/* StyleX Next development native stylesheet marker. */\n" : audited;
          },
        });
        record = { candidate, context, error, native: null, raw, target };
        contexts.set(context, record);
        active = record;
        return context;
      } finally { preparing = false; }
    },
    validate(context: NextDevCompilationContext, relevant: boolean) { return validate(captured(context), relevant); },
    installNative(context: NextDevCompilationContext, compilation: NextDevNativeCompilation, webpack: NextDevNativeWebpack,
      factoryExpression: string, relevant: () => boolean): void {
      const record = captured(context);
      assert.equal(record.target, "client", "Next development only the client compiler can install native delivery");
      assert.equal(record.native, null, "Next development compilation already has native publication hooks");
      admit(record);
      record.native = installNextDevNativeCompilation({ compilation, delivery: producer!.compilation(record.candidate!), factoryExpression, relevant, webpack });
    },
    hasNativeCandidate(context: NextDevCompilationContext): boolean { return captured(context).candidate !== null; },
    complete(context: NextDevCompilationContext, relevant: boolean, succeeded: boolean) { finish(captured(context), relevant, succeeded); },
    abort(target: NextDevCompilerTarget): void {
      if (active === null) { assert.equal(preparing, false, "Next development failure arrived before preparation settled"); return; }
      assert.equal(active.target, target, "Next development compiler cannot abort another target's candidate");
      finish(active, false, false);
    },
    inspect: () => Object.freeze({ active: active?.target ?? null, preparing, registry, producer: producer?.inspect() ?? null }),
  });
}
