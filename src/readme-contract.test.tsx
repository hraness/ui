import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CopyButton,
} from "./index";

type PackageManifest = Readonly<{
  dependencies: Readonly<Record<string, string>>;
  description: string;
  exports: Readonly<Record<string, unknown>>;
  peerDependencies: Readonly<Record<string, string>>;
  scripts: Readonly<Record<string, string>>;
  version: string;
}>;

const repositoryRoot = new URL("../", import.meta.url);
const readme = await readFile(new URL("README.md", repositoryRoot), "utf8");
const tokens = await readFile(new URL("src/tokens.css", repositoryRoot), "utf8");
const manifest = JSON.parse(
  await readFile(new URL("package.json", repositoryRoot), "utf8"),
) as PackageManifest;

test("leads readers from a first render through proof, boundaries, and action", () => {
  const headings = [
    "## First render",
    "## Proof in the package",
    "## Composable interface map",
    "## Compatibility and authority boundaries",
    "## Evidence",
    "## Frequently asked questions",
    "## Next action",
  ];
  const positions = headings.map((heading) => readme.indexOf(heading));

  expect(readme.startsWith("# @hraness/ui\n")).toBeTrue();
  expect(positions.every((position) => position >= 0)).toBeTrue();
  expect(positions).toEqual([...positions].sort((left, right) => left - right));
  expect(readme).toContain(manifest.description);
  expect(readme).not.toContain("—");
});

test("keeps installation and compatibility claims pinned to the package manifest", () => {
  expect(readme).toContain(`github:hraness/ui#v${manifest.version}`);
  expect(manifest.peerDependencies).toEqual({
    react: ">=18 <20",
    "react-dom": ">=18 <20",
  });
  expect(readme).toContain("React 18 or 19 and React DOM 18 or 19");

  const cssExports = Object.keys(manifest.exports).filter((path) => path.endsWith(".css"));
  expect(cssExports).toHaveLength(6);
  for (const path of cssExports) expect(readme).toContain(`@hraness/ui${path.slice(1)}`);
});

test("pins the token proof to the checked public stylesheet", () => {
  const themeRoles = new Set(tokens.match(/--ui-[a-z0-9-]+/gu) ?? []);

  expect(themeRoles.size).toBe(37);
  expect(readme).toContain("37 namespaced theme roles");
  expect(readme).toContain("`--ui-background`");
  expect(readme).toContain("`--ui-primary`");
  expect(readme).toContain("`--ui-ring`");
});

test("proves the documented first render at the semantic component boundary", () => {
  const html = renderToStaticMarkup(
    <Card tone="card">
      <CardHeader>
        <CardTitle>Local preview</CardTitle>
        <CardDescription>A Vite application running on this computer.</CardDescription>
      </CardHeader>
      <CardContent><code>http://localhost:5173</code></CardContent>
      <CardFooter>
        <CopyButton copyLabel="Copy preview URL" value="http://localhost:5173" />
      </CardFooter>
    </Card>,
  );

  expect(html).toContain('data-slot="card"');
  expect(html).toContain('data-slot="card-title"');
  expect(html).toContain('data-slot="button-control"');
  expect(html).toContain('data-slot="copy-button-status"');
  expect(html).toContain("Local preview");
  expect(readme).toContain("Copy preview URL");
  expect(readme).toContain("http://localhost:5173");
});

test("names real evidence gates and preserves the directional package boundary", async () => {
  const documentedGates = [
    "check",
    "check:committed-dist",
    "check:portfolio-inventory",
    "check:stylex-artifacts",
    "check:stylex-determinism",
    "test",
    "test:browser",
    "test:package",
    "test:packed-bun-browser",
    "typecheck",
  ];

  for (const gate of documentedGates) {
    expect(manifest.scripts).toHaveProperty(gate);
    expect(readme).toContain(`bun run ${gate}`);
  }
  expect(manifest.dependencies).not.toHaveProperty("@hraness/design-kit");
  expect(readme).toContain("It has no dependency on a framework, `@hraness/design-kit`, or a product repository.");
  expect(await Bun.file(new URL("CONTRIBUTING.md", repositoryRoot)).exists()).toBeTrue();
  expect(await Bun.file(new URL("SECURITY.md", repositoryRoot)).exists()).toBeTrue();
});
