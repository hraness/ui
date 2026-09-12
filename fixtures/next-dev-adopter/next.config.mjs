import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withStylexNextDev } from "@hraness/ui/stylex-build/next-dev";

const rootDirectory = dirname(fileURLToPath(import.meta.url));

export default function config(phase) {
  if (phase !== "phase-development-server") throw new Error("This fixture only supports next dev --webpack.");
  return withStylexNextDev({ outputFileTracingRoot: rootDirectory, reactStrictMode: true }, {
    cssEntry: "app/stylex-dev.css",
    packageManifests: ["node_modules/@hraness/ui/dist/stylex-manifest.json"],
    rootDirectory,
    sourceDirectories: ["app"],
  });
}
