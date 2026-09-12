/** Browser-only factory embedded before Webpack runs any client entry. */
import { createNextDevDocumentOwner } from "./next-dev-document.js";
import { parseNextDevConsumerDescriptor } from "./next-dev-consumers.js";
import { createNextDevResponseRequests } from "./next-dev-responses.js";
import { assertNextDevBrowserOwnerVacant, installNextDevBrowserOwner } from "./next-dev-browser-owner.js";
import {
  parseNextDevWebpackCatalogue,
  parseNextDevWebpackUpdateMetadata,
  type NextDevWebpackBridgeOwner,
  type NextDevWebpackCatalogue,
  type NextDevWebpackUpdateMetadata,
} from "./next-dev-webpack-bridge.js";

export type NextDevBootstrapOwner = NextDevWebpackBridgeOwner & Readonly<{
  documentOwner: ReturnType<typeof createNextDevDocumentOwner>;
  responseOwner: ReturnType<typeof createNextDevResponseRequests>;
}>;

/** No React imports: importing this factory cannot depend on gated entry startup. */
export function createNextDevBridgeOwner(document: Document, value: unknown): NextDevBootstrapOwner {
  const initial = parseNextDevWebpackCatalogue(value);
  if (initial.snapshots.at(-1)?.sequence !== initial.currentSequence) throw new Error("Next development bootstrap must select its newest captured snapshot");
  const selected = initial.snapshots.at(-1)!;
  const sourceIdentity = JSON.stringify(initial.consumers);
  const captured = new Map(initial.snapshots.map((snapshot) => [snapshot.sequence, JSON.stringify(snapshot)]));
  const native = createNextDevDocumentOwner(document, { consumers: initial.consumers, initial: selected,
    session: initial.session, snapshots: initial.snapshots });
  const pending = new Map<number, Promise<void>>();
  pending.set(selected.sequence, native.startupReady);
  let highest = selected.sequence;
  let stopped = false;
  const stop = (): void => { stopped = true; native.restartRequired(); };
  const view = document.defaultView!;
  const responses = createNextDevResponseRequests({
    classify(value, floor) {
      const descriptor = parseNextDevConsumerDescriptor(value);
      const registered = initial.consumers.find(({ source }) => source === descriptor.source);
      if (descriptor.session !== initial.session || registered === undefined || registered.target !== descriptor.target) {
        throw new Error("Next development response differs from its captured session or source registry");
      }
      const identity = captured.get(descriptor.sequence);
      if (identity === undefined) {
        if (descriptor.sequence <= highest) throw new Error("Next development response claims uncaptured historical authority");
        return { descriptor, status: "future" };
      }
      if (identity !== JSON.stringify({ includedRevisions: descriptor.includedRevisions, revision: descriptor.revision,
        sequence: descriptor.sequence, stylesheetSha256: descriptor.stylesheetSha256 })) {
        throw new Error("Next development response differs from exact captured producer metadata");
      }
      if (descriptor.sequence < floor || !native.inspect().ledger.residentSequences.includes(descriptor.sequence)) {
        return { descriptor, status: "stale" };
      }
      native.captured(descriptor);
      return { descriptor, status: native.canRender(descriptor) ? "ready" : "unready" };
    },
    setTimeout: (callback, milliseconds) => view.setTimeout(callback, milliseconds),
    clearTimeout: (id) => view.clearTimeout(id),
    restartRequired: stop,
  });
  native.subscribe(() => {
    const phase = native.getSnapshot().phase;
    if (phase === "closed") responses.close();
    else if (phase === "restart-required") responses.restartRequired();
    else responses.changed();
  });

  const adopt = (input: NextDevWebpackCatalogue): Promise<void> => {
    if (stopped) throw new Error("Next development bootstrap requires restart");
    try {
      const catalogue = parseNextDevWebpackCatalogue(input);
      if (catalogue.session !== initial.session || JSON.stringify(catalogue.consumers) !== sourceIdentity) {
        throw new Error("Next development document session or finite consumer registry changed");
      }
      if (catalogue.snapshots.at(-1)?.sequence !== catalogue.currentSequence) throw new Error("Next development catalogue must select its newest captured snapshot");
      if (catalogue.currentSequence < highest) throw new Error("Next development catalogue cannot roll the document backwards");
      const additions = catalogue.snapshots.filter((snapshot) => !captured.has(snapshot.sequence));
      // Validate the complete incoming authority before starting any acquisition.
      for (const snapshot of catalogue.snapshots) {
        const previous = captured.get(snapshot.sequence);
        if (previous !== undefined && previous !== JSON.stringify(snapshot)) throw new Error("Next development captured snapshot identity changed");
        if (previous === undefined && snapshot.sequence <= highest) throw new Error("Next development catalogue introduced an unowned historical snapshot");
      }
      if (captured.size + additions.length > 32) throw new Error("Next development document catalogue limit requires restart");
      for (const snapshot of additions) {
        // Register authority synchronously before awaiting CSS or hydration. An
        // early Edge/Node Flight response may need this exact descriptor to
        // complete the bootstrap census that the HMR application then awaits.
        captured.set(snapshot.sequence, JSON.stringify(snapshot));
        highest = snapshot.sequence;
        const acquisition = native.available(snapshot);
        pending.set(snapshot.sequence, acquisition);
        void acquisition.catch(stop);
      }
      return Promise.all(additions.map((snapshot) => pending.get(snapshot.sequence)!)).then(() => {});
    } catch (error) {
      stop();
      throw error;
    }
  };

  return Object.freeze({
    documentOwner: native,
    responseOwner: responses,
    startupReady: native.startupReady,
    hydrationReady: native.hydrationReady,
    adopt,
    async updateReady(input: NextDevWebpackUpdateMetadata): Promise<void> {
      if (stopped) throw new Error("Next development bootstrap requires restart");
      const metadata = parseNextDevWebpackUpdateMetadata(input);
      if (metadata.session !== initial.session) throw new Error("Next development hot-update session differs from its document");
      const sequence = metadata.catalogue.currentSequence;
      const snapshot = metadata.catalogue.snapshots.find((entry) => entry.sequence === sequence)!;
      if (captured.get(sequence) !== JSON.stringify(snapshot)) throw new Error("Next development hot-update snapshot was not adopted");
      await pending.get(sequence);
      const active = native.getSnapshot();
      if (active.phase !== "ready" || active.active === null || !active.active.includedRevisions.includes(snapshot.revision)) {
        throw new Error("Next development hot update has no active native CSS covering its exact source revision");
      }
    },
    restartRequired: stop,
  });
}

/** Called by the shipped BASIC runtime factory before any client entry starts. */
export function installNextDevBridgeOwner(document: Document, value: unknown): NextDevBootstrapOwner {
  assertNextDevBrowserOwnerVacant(document);
  const owner = createNextDevBridgeOwner(document, value);
  try { installNextDevBrowserOwner(document, owner); }
  catch (error) { owner.documentOwner.close(); throw error; }
  return owner;
}
