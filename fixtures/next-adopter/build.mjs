import { nextVersion } from "./profile.mjs";
import { runStylexNextBuild } from "@hraness/ui/stylex-build/next";

const complete = await runStylexNextBuild({
  nextVersion,
  attemptId: "packed-next-adopter",
  packageManifests: [
    "node_modules/@fixture/theme/dist/stylex-manifest.json",
    "node_modules/@hraness/ui/dist/stylex-manifest.json",
  ],
  requiredSources: {
    client: [
      "app/client.tsx", "app/global-error.tsx", "app/lazy.tsx",
      "app/shared-history/category-icon.tsx",
      "app/shared-history/history-measure-rail.tsx",
      "app/shared-history/history-sticky-offset-sync.tsx",
      "app/shared-history/shared-history.stylex.ts",
    ],
    edgeRsc: ["app/edge/page.tsx", "app/global-error.tsx", "app/layout.tsx"],
    nodeRsc: [
      "app/client.tsx",
      "app/delegated-one/page.tsx",
      "app/delegated-two/page.tsx",
      "app/global-error-proof/page.tsx",
      "app/global-error.tsx",
      "app/index/[manifestProof]/page.tsx",
      "app/layout.tsx",
      "app/lazy.tsx",
      "app/page.tsx",
      "app/shared-history/category-icon.tsx",
      "app/shared-history/history-measure-rail.tsx",
      "app/shared-history/history-sticky-offset-sync.tsx",
      "app/shared-history/shared-history.stylex.ts",
      "app/shared-history/shared-history.tsx",
      "proxy.ts",
    ],
  },
  rootDirectory: process.cwd(),
});

console.log(JSON.stringify(complete));
