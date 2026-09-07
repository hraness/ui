import { withStylexNext } from "@hraness/ui/stylex-build/next";
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants.js";

const rootDirectory = process.cwd();

const config = {
  outputFileTracingRoot: rootDirectory,
  async headers() {
    return [{
      headers: [{
        key: "Content-Security-Policy",
        value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'",
      }],
      source: "/:path*",
    }];
  },
  reactStrictMode: true,
};

export default function nextConfig(phase) {
  if (phase === PHASE_PRODUCTION_SERVER) return config;
  if (phase !== PHASE_PRODUCTION_BUILD) {
    throw new Error("This compiled fixture supports production build and start only; development/HMR is not configured.");
  }
  return withStylexNext(config, {
    packageManifests: [
      "node_modules/@fixture/theme/dist/stylex-manifest.json",
      "node_modules/@hraness/ui/dist/stylex-manifest.json",
    ],
    rootDirectory,
  });
}
