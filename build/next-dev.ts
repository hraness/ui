/** Opt-in development adapter. Private browser entries remain unexported. */
import { fileURLToPath } from "node:url";
import { createNextDevAdapter } from "./next-dev-adapter.js";
import { nextDevPrivateArtifactPaths, readNextDevPrivateArtifacts } from "./next-dev-artifacts.js";
import type { StylexNextDevOptions } from "./next-dev-session.js";
export { STYLEX_NEXT_DEV_CSS_ENTRY, STYLEX_NEXT_DEV_VERSION } from "./next-dev-session.js";
export type { StylexNextDevOptions } from "./next-dev-session.js";

/** Select this configuration only for Next's development phase. */
export function withStylexNextDev<T extends object>(config: T, options: StylexNextDevOptions): T {
  return createNextDevAdapter(config, options, {
    clientPath: nextDevPrivateArtifactPaths(import.meta.url).clientPath,
    sourceLoader: fileURLToPath(new URL("./next-dev-loader.cjs", import.meta.url)),
    cssLoader: fileURLToPath(new URL("./next-dev-css-loader.cjs", import.meta.url)),
    read: () => readNextDevPrivateArtifacts(import.meta.url),
  });
}
