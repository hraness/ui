import type { Plugin } from "vite";
import { stylexVite, type StylexViteOptions } from "@hraness/ui/stylex-build/vite";
import { createStylexGeneration } from "@hraness/ui/stylex-build";

const options = null as unknown as StylexViteOptions;
const plugin: Plugin = stylexVite(options);
const mappedPlugin: Plugin = stylexVite({ ...options, sourceMaps: "external" });
// @ts-expect-error Hidden and inline maps are not an owned external-map profile.
stylexVite({ ...options, sourceMaps: "hidden" });
void plugin;
void mappedPlugin;
void createStylexGeneration;
// @ts-expect-error Public Vite declarations must not require Bun's ambient types.
void Bun;
