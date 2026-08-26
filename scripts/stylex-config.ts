import type { UserOptions } from "@stylexjs/unplugin";

export function stylexCompilerOptions(rootDir: string): Partial<UserOptions> {
  return {
    classNamePrefix: "x",
    dev: false,
    importSources: ["@stylexjs/stylex"],
    runtimeInjection: false,
    styleResolution: "property-specificity",
    sxPropName: false,
    treeshakeCompensation: true,
    unstable_moduleResolution: {
      rootDir,
      type: "commonJS",
    },
    useCSSLayers: {
      prefix: "components.hraness-ui",
    },
  };
}
