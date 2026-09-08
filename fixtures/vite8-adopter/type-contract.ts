import type { Plugin } from "vite";
import { stylexVite, type StylexViteOptions } from "@hraness/ui/stylex-build/vite";
import { createStylexGeneration } from "@hraness/ui/stylex-build";

const options = null as unknown as StylexViteOptions;
const plugin: Plugin = stylexVite(options);
void plugin;
void createStylexGeneration;
// @ts-expect-error Public Vite declarations must not require Bun's ambient types.
void Bun;
