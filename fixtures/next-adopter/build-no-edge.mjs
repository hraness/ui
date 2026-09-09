import { nextVersion } from "./profile.mjs";
import { runStylexNextBuild } from "@hraness/ui/stylex-build/next";

const complete = await runStylexNextBuild({
  nextVersion,
  attemptId: "packed-next-adopter-no-edge",
  packageManifests: [
    "node_modules/@fixture/theme/dist/stylex-manifest.json",
    "node_modules/@hraness/ui/dist/stylex-manifest.json",
  ],
  requiredSources: {
    client: ["app/client.tsx", "app/global-error.tsx", "app/lazy.tsx"],
    edgeRsc: [],
    nodeRsc: [
      "app/client.tsx",
      "app/global-error-proof/page.tsx",
      "app/global-error.tsx",
      "app/index/[manifestProof]/page.tsx",
      "app/layout.tsx",
      "app/lazy.tsx",
      "app/page.tsx",
      "proxy.ts",
    ],
  },
  rootDirectory: process.cwd(),
});

console.log(JSON.stringify(complete));
