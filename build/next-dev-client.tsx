"use client";

/** Private, not packaged: React commit custody for the separate development profile. */
import {
  Suspense,
  createElement,
  useDeferredValue,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { readNextDevBrowserOwner } from "./next-dev-browser-owner.js";
import { parseNextDevConsumerDescriptor, type NextDevConsumerDescriptor } from "./next-dev-consumers.js";
import { NEXT_DEV_CONSUMER_ATTRIBUTE, NEXT_DEV_DESCRIPTOR_ATTRIBUTE } from "./next-dev-document.js";
import { createNextDevResponseHandle, type NextDevResponseHandle } from "./next-dev-responses.js";
import type { NextDevBootstrapOwner } from "./next-dev-bootstrap.js";

type NativeTag = "main" | "section" | "p";
export type StylexNextDevConsumerProps = Omit<HTMLAttributes<HTMLElement>, "dangerouslySetInnerHTML"> & Readonly<{
  as: NativeTag;
  revision: NextDevConsumerDescriptor;
}>;
type Selection = Readonly<{
  as: NativeTag;
  descriptor: NextDevConsumerDescriptor;
  native: Omit<HTMLAttributes<HTMLElement>, "dangerouslySetInnerHTML">;
}>;
type Instance = {
  accepted: Selection | null;
  floor: number;
  handle: NextDevResponseHandle;
  requested: NextDevConsumerDescriptor | null;
};
const noop = (): void => {};
const serverSnapshot = (): null => null;
const owner = (): NextDevBootstrapOwner => readNextDevBrowserOwner(document);
const open = (current: NextDevBootstrapOwner): boolean => {
  const phase = current.documentOwner.getSnapshot().phase;
  return phase !== "closed" && phase !== "restart-required" && current.responseOwner.getSnapshot().phase === "open";
};
const documentSnapshot = () => owner().documentOwner.getSnapshot();
const responseSnapshot = () => owner().responseOwner.getSnapshot();
const subscribeDocument = (listener: () => void): (() => void) => {
  const current = owner();
  return open(current) ? current.documentOwner.subscribe(listener) : noop;
};
const subscribeResponses = (listener: () => void): (() => void) => {
  const current = owner();
  return open(current) ? current.responseOwner.subscribe(listener) : noop;
};
const same = (left: NextDevConsumerDescriptor, right: NextDevConsumerDescriptor): boolean => JSON.stringify(left) === JSON.stringify(right);

/** The compiler must replace this marker with exact captured producer metadata. */
export function stylexNextDevRevision(): NextDevConsumerDescriptor {
  throw new Error("Next development revision marker was not transformed");
}

/** One committed, style-free document binds only the public router refresh API. */
export function StylexNextDevDocument({ children }: Readonly<{ children?: ReactNode }>): ReactNode {
  const router = useRouter();
  useLayoutEffect(() => {
    const current = owner();
    if (!open(current)) return;
    // Child layout effects run first. Neither binding nor a root allocation is
    // needed during render, and Strict replay releases only these subscriptions.
    const unsubscribe = current.documentOwner.subscribeDocument(noop);
    let unbind = noop;
    try { unbind = current.responseOwner.bindRefresh(() => router.refresh()); }
    catch { unsubscribe(); current.restartRequired("react-document-refresh-owner"); }
    return () => { unbind(); unsubscribe(); };
  }, [router]);
  return children;
}

function selection(props: StylexNextDevConsumerProps): Selection {
  if (!["main", "section", "p"].includes(props.as)) throw new Error("Next development consumer requires its finite native root");
  for (const key of ["ref", "dangerouslySetInnerHTML", NEXT_DEV_CONSUMER_ATTRIBUTE, NEXT_DEV_DESCRIPTOR_ATTRIBUTE]) {
    if (Object.hasOwn(props, key)) throw new Error("Next development consumer root custody cannot be overridden");
  }
  const { as, revision, ...native } = props;
  return { as, descriptor: parseNextDevConsumerDescriptor(revision), native };
}

function request(current: NextDevBootstrapOwner, instance: Instance, value: unknown, wake: () => void): boolean {
  if (!open(current)) return false;
  try {
    current.responseOwner.request(instance.handle, value, instance.floor, wake);
    instance.requested = parseNextDevConsumerDescriptor(value);
    return true;
  } catch {
    // The existing owner records explicit terminal state. Never enter Next's
    // error/reload path when an already-mounted consumer loses authority.
    current.restartRequired("react-response-request");
    return false;
  }
}

function NativeRoot({ selected, desired, instance, wake }: Readonly<{
  selected: Selection;
  desired: unknown;
  instance: Instance;
  wake: () => void;
}>): ReactNode {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const current = owner();
    const root = ref.current;
    if (root === null || !open(current)) return;
    // A child's layout setup precedes its outer owner's setup, including Strict
    // replay. Register the *latest request*, not the deferred/last-good root,
    // before accepting any native commit. A retained root cannot discharge a
    // newer request merely because that newer subtree is still suspended.
    if (!request(current, instance, desired, wake)) return;
    try {
      if (current.responseOwner.classify(selected.descriptor, instance.floor).status !== "ready") {
        current.restartRequired("react-native-root-unready");
        return;
      }
      current.documentOwner.committed(root, selected.descriptor);
      if (same(selected.descriptor, parseNextDevConsumerDescriptor(desired))) {
        current.responseOwner.responseCommitted(instance.handle, selected.descriptor);
      }
      instance.accepted = selected;
      instance.floor = selected.descriptor.sequence;
    } catch { current.restartRequired("react-native-root-commit"); return; }
    return () => {
      // Parking is not retirement. The independent document observer alone
      // decides when a parked native root has actually disconnected.
      if (open(current)) {
        try { current.documentOwner.parked(root); }
        catch { current.restartRequired("react-native-root-cleanup"); }
      }
    };
  }, [selected, desired, instance, wake]);
  return createElement(selected.as, {
    ...selected.native,
    [NEXT_DEV_CONSUMER_ATTRIBUTE]: selected.descriptor.source,
    [NEXT_DEV_DESCRIPTOR_ATTRIBUTE]: JSON.stringify(selected.descriptor),
    ref,
  });
}

/** The request owner itself never suspends and never publishes CSS authority. */
export function StylexNextDevConsumer(props: StylexNextDevConsumerProps): ReactNode {
  const [instance] = useState<Instance>(() => ({ accepted: null, floor: 0, handle: createNextDevResponseHandle(), requested: null }));
  const [, wake] = useReducer((version: number) => version + 1, 0);
  const documentState = useSyncExternalStore(subscribeDocument, documentSnapshot, serverSnapshot);
  const responseState = useSyncExternalStore(subscribeResponses, responseSnapshot, serverSnapshot);
  const parsed = useMemo(() => {
    try { return { selected: selection(props), invalid: false } as const; }
    catch { return { selected: null, invalid: true } as const; }
  }, [props]);
  const terminal = documentState?.phase === "closed" || documentState?.phase === "restart-required"
    || (responseState !== null && responseState.phase !== "open");
  let invalid = parsed.invalid;
  let candidate = instance.accepted;
  if (!terminal && parsed.selected !== null) {
    const descriptor = parsed.selected.descriptor;
    const previous = instance.requested;
    if (previous !== null && (descriptor.source !== previous.source || descriptor.session !== previous.session)) invalid = true;
    else if (documentState === null) candidate = parsed.selected; // deterministic SSR / initial hydration snapshot
    else {
      try {
        if (owner().responseOwner.classify(descriptor, instance.floor).status === "ready") candidate = parsed.selected;
      } catch { invalid = true; }
    }
  }
  if (invalid) candidate = instance.accepted;
  // A ready response can contain genuinely suspended children. Defer that
  // selection so React keeps the accepted subtree and its client state mounted.
  const deferred = useDeferredValue(candidate);
  const selected = terminal || invalid ? instance.accepted : deferred;
  useLayoutEffect(() => {
    const current = owner();
    if (!open(current)) return;
    if (invalid) current.restartRequired("react-consumer-metadata");
    else request(current, instance, props.revision, wake);
    return () => { current.responseOwner.park(instance.handle); };
  }, [props.revision, invalid, instance, wake]);
  if (documentState === null && invalid) throw new Error("Next development consumer has invalid server metadata or root custody");
  return <Suspense fallback={null}>{selected === null ? null
    : <NativeRoot selected={selected} desired={props.revision} instance={instance} wake={wake} />}</Suspense>;
}
