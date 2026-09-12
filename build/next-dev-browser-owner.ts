/** Private document-local bridge access; not a production UI runtime import. */
import type { NextDevBootstrapOwner } from "./next-dev-bootstrap.js";

const KEY = Symbol.for("@hraness/ui/stylex-next-dev/document-owner-v1");

/** Check before allocating native links, observers, timers or response stores. */
export function assertNextDevBrowserOwnerVacant(document: Document): void {
  if (Object.getOwnPropertyDescriptor(document, KEY) !== undefined) {
    throw new Error("Next development native document owner was replaced");
  }
}

export function installNextDevBrowserOwner(document: Document, owner: NextDevBootstrapOwner): void {
  assertNextDevBrowserOwnerVacant(document);
  if (!Object.isFrozen(owner)) {
    throw new Error("Next development native document owner was replaced or is mutable");
  }
  Object.defineProperty(document, KEY, { configurable: false, enumerable: false, value: owner, writable: false });
}

export function readNextDevBrowserOwner(document: Document): NextDevBootstrapOwner {
  const property = Object.getOwnPropertyDescriptor(document, KEY);
  if (property === undefined || property.configurable || property.enumerable || property.writable || !Object.hasOwn(property, "value")
    || typeof property.value !== "object" || property.value === null || !Object.isFrozen(property.value)) {
    throw new Error("Next development native document owner is unavailable");
  }
  return property.value as NextDevBootstrapOwner;
}
