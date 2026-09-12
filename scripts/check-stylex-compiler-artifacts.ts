import assert from "node:assert/strict";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  canonicalJson,
  compilerContract,
  compilerSha256,
  readStylexPackageManifest,
  serializeStylexPackageRules,
  sha256,
} from "../build/compiler.js";

type PackageJson = Readonly<{
  exports?: Readonly<Record<string, unknown>>;
  name?: unknown;
  peerDependencies?: Readonly<Record<string, unknown>>;
  peerDependenciesMeta?: Readonly<Record<string, unknown>>;
  version?: unknown;
}>;

function logical(root: string, path: string): string {
  const value = relative(root, path).split(sep).join("/");
  assert.ok(value.length > 0 && value !== ".." && !value.startsWith("../"), `Artifact escapes dist: ${path}`);
  return value;
}

async function filesBelow(root: string, directory = root): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), `dist contains a symlink: ${logical(root, path)}`);
    if (entry.isDirectory()) paths.push(...await filesBelow(root, path));
    else {
      assert.ok(entry.isFile(), `dist contains a nonordinary artifact: ${logical(root, path)}`);
      paths.push(logical(root, path));
    }
  }
  return paths.sort();
}

function importTarget(value: unknown, description: string): string {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${description} must be a conditional export`);
  const record = value as Record<string, unknown>;
  assert.deepEqual(Object.keys(record).sort(), ["import", "types"]);
  assert.ok(typeof record.import === "string" && record.import.startsWith("./dist/build/"), `${description}.import must target dist/build`);
  assert.ok(typeof record.types === "string" && record.types.startsWith("./build/"), `${description}.types must target build source`);
  return record.import.slice(2);
}

function optionalPeer(manifest: PackageJson, name: string, version: string): void {
  assert.equal(manifest.peerDependencies?.[name], version, `${name} optional peer range changed`);
  assert.deepEqual(manifest.peerDependenciesMeta?.[name], { optional: true }, `${name} must remain optional`);
}

const repository = process.cwd();
const compilerStylesheetPaths = [
  "src/compiler-foundation.css",
  "src/compiler-reset.css",
  "src/components.css",
  "src/reset.css",
  "src/styles.css",
  "src/tokens.css",
] as const;
const publicCssExports = {
  "./compiler-foundation.css": "./src/compiler-foundation.css",
  "./components.css": "./src/components.css",
  "./reset.css": "./src/reset.css",
  "./styles.css": "./src/styles.css",
  "./stylex.css": "./dist/stylex.css",
  "./tokens.css": "./src/tokens.css",
} as const;
assert.equal(Bun.version, "1.3.14", "Compiler artifact checks require Bun 1.3.14");
const dist = resolve(repository, "dist");
const manifestPath = resolve(dist, "stylex-manifest.json");
const [packageSource, manifestSource] = await Promise.all([
  readFile(resolve(repository, "package.json"), "utf8"),
  readFile(manifestPath, "utf8"),
]);
const packageJson = JSON.parse(packageSource) as PackageJson;
const manifest = await readStylexPackageManifest(manifestPath, repository);
assert.deepEqual(manifest.package, { name: packageJson.name, version: packageJson.version });
assert.equal(manifest.compilerSha256, compilerSha256);
assert.equal(manifestSource, `${canonicalJson(manifest)}\n`, "StyleX package manifest must be canonical");
assert.ok(!manifestSource.includes(repository), "StyleX package manifest contains its absolute build root");
assert.ok(!/"(?:timestamp|pid|temporary|createdAt|updatedAt)"/u.test(manifestSource), "StyleX package manifest contains ambient build identity");

optionalPeer(packageJson, "@babel/core", "7.29.7");
optionalPeer(packageJson, "@stylexjs/babel-plugin", "0.19.0");
optionalPeer(packageJson, "@types/babel__core", "7.20.5");
optionalPeer(packageJson, "@types/bun", "1.3.14");
optionalPeer(packageJson, "@types/node", "^20.19.0 || >=22.12.0");
optionalPeer(packageJson, "lightningcss", "1.33.0");
optionalPeer(packageJson, "next", "16.2.12 || 16.3.3");
optionalPeer(packageJson, "vite", "7.3.6 || 8.2.1");

const exportsRecord = packageJson.exports;
assert.ok(exportsRecord !== undefined, "package exports are missing");
assert.deepEqual(
  Object.fromEntries(Object.entries(exportsRecord).filter(([key]) => key.endsWith(".css"))),
  publicCssExports,
  "Package must expose exactly the six standards-based CSS entrypoints",
);
assert.equal(exportsRecord["./stylex-manifest.json"], "./dist/stylex-manifest.json");
assert.equal(exportsRecord["./compiler-foundation.css"], "./src/compiler-foundation.css");
assert.equal(exportsRecord["./compiler-reset.css"], undefined, "Compiler reset must remain package-internal");
const exportedBuildTools = [
  importTarget(exportsRecord["./stylex-build"], "stylex-build export"),
  importTarget(exportsRecord["./stylex-build/bun"], "stylex-build/bun export"),
  importTarget(exportsRecord["./stylex-build/next"], "stylex-build/next export"),
  importTarget(exportsRecord["./stylex-build/next-dev"], "stylex-build/next-dev export"),
  importTarget(exportsRecord["./stylex-build/next-output"], "stylex-build/next-output export"),
  importTarget(exportsRecord["./stylex-build/vite"], "stylex-build/vite export"),
].sort();

const paths = await filesBelow(dist);
const runtime = paths.filter((path) => path.endsWith(".js") && !path.startsWith("build/"));
const buildTools = paths.filter((path) => /\.(?:c|m)?js$/u.test(path) && path.startsWith("build/"));
assert.ok(runtime.length > 0 && buildTools.length >= exportedBuildTools.length, "dist must contain runtime and build-tool JavaScript");
for (const path of exportedBuildTools) {
  assert.ok(paths.includes(path.replace(/^dist\//u, "")), `Missing exported build tool ${path}`);
  await import(pathToFileURL(resolve(repository, ...path.split("/"))).href);
}
assert.deepEqual(manifest.runtime.map(({ path }) => path), runtime.map((path) => `dist/${path}`), "Manifest runtime inventory is incomplete");
assert.deepEqual(manifest.buildTools.map(({ path }) => path), buildTools.map((path) => `dist/${path}`), "Manifest build-tool inventory is incomplete");
assert.equal(manifest.standaloneCss.path, "dist/stylex.css");
assert.equal(manifest.standaloneCss.sha256, sha256(await readFile(resolve(dist, "stylex.css"))));
assert.equal(
  await readFile(resolve(dist, "stylex.css"), "utf8"),
  serializeStylexPackageRules(manifest.rules, manifest.standaloneSerializer),
);
assert.deepEqual(manifest.standaloneSerializer, compilerContract.serializer.useLayers);
assert.equal(manifest.compilerFoundation, "src/compiler-foundation.css");
assert.deepEqual(
  manifest.stylesheets.map(({ path }) => path),
  [...compilerStylesheetPaths].sort(),
  "Manifest compiler stylesheet inventory is incomplete",
);
for (const stylesheet of manifest.stylesheets) {
  const bytes = await readFile(resolve(repository, ...stylesheet.path.split("/")));
  assert.deepEqual(
    { bytes: stylesheet.bytes, sha256: stylesheet.sha256 },
    { bytes: bytes.byteLength, sha256: sha256(bytes) },
    `Manifest compiler stylesheet binding changed: ${stylesheet.path}`,
  );
}
assert.equal(
  manifest.stylesheets.filter(({ path }) => path === manifest.compilerFoundation).length,
  1,
  "Manifest compiler foundation must identify exactly one bound stylesheet",
);

for (const path of runtime) {
  const source = await readFile(resolve(dist, ...path.split("/")), "utf8");
  assert.ok(source.startsWith('"use client";\n'), `Runtime is not client-marked: ${path}`);
  for (const dependency of ["@babel/core", "@stylexjs/babel-plugin", "lightningcss", "./build/"]) {
    assert.ok(!source.includes(dependency), `UI runtime contains compiler dependency ${dependency}: ${path}`);
  }
}
for (const path of buildTools) {
  const source = await readFile(resolve(dist, ...path.split("/")), "utf8");
  assert.ok(!source.startsWith('"use client";\n'), `Build tool was client-marked: ${path}`);
}

const [foundation, compilerReset, publicReset] = await Promise.all([
  readFile(resolve(repository, "src/compiler-foundation.css"), "utf8"),
  readFile(resolve(repository, "src/compiler-reset.css"), "utf8"),
  readFile(resolve(repository, "src/reset.css"), "utf8"),
]);
const fixedPriorityPrelude = "@layer components.hraness-ui.legacy, components.hraness-ui.priority1, components.hraness-ui.priority2, components.hraness-ui.priority3, components.hraness-ui.priority4;\n";
assert.ok([foundation, compilerReset].every((source) => !source.includes("stylex.css")), "Compiler foundation imports standalone StyleX recipes");
assert.doesNotMatch(packageSource, /tailwind/iu, "Package manifest retains a first-party Tailwind contract");
assert.equal(
  foundation,
  '@layer base, components;\n@layer components.hraness-ui.legacy;\n\n@import "./tokens.css";\n@import "./compiler-reset.css";\n@import "./components.css";\n',
  "Standards compiler foundation must contain the exact recipe-free layer and import contract",
);
assert.equal(
  compilerReset,
  publicReset.replace(fixedPriorityPrelude, ""),
  "Compiler reset must differ from the public reset only by its fixed priority prelude",
);
assert.doesNotMatch(
  `${foundation}\n${compilerReset}`,
  /components\.hraness-ui\.priority\d+/u,
  "Compiler foundation must not hide a fixed StyleX priority declaration",
);
console.log(`Verified ${String(runtime.length)} marked runtime files, ${String(buildTools.length)} unmarked build-tool files, ${String(manifest.rules.length)} canonical StyleX rules, one bound standalone stylesheet, and ${String(manifest.stylesheets.length)} exact compiler-adopter stylesheets`);
