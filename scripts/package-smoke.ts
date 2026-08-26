import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

type ReactRelease = Readonly<{
  label: string;
  reactTypes: string;
  reactDomTypes: string;
  version: string;
}>;

const reactReleases: readonly ReactRelease[] = [
  {
    label: "react-18",
    reactTypes: "^18.3.0",
    reactDomTypes: "^18.3.0",
    version: "18.3.1",
  },
  {
    label: "react-19",
    reactTypes: "^19.2.0",
    reactDomTypes: "^19.2.0",
    version: "19.2.3",
  },
];

async function run(command: string[], cwd: string): Promise<void> {
  const process = Bun.spawn(command, {
    cwd,
    env: environment,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) throw new Error(`Command failed (${String(exitCode)}): ${command.join(" ")}`);
}

function resolveGenuineNodeExecutable(): string {
  const executableName = process.platform === "win32" ? "node.exe" : "node";
  const identityProbe = [
    "if (typeof Bun !== 'undefined'",
    "|| process.versions.bun !== undefined",
    "|| !process.versions.node?.startsWith('24.')) process.exit(1)",
  ].join(" ");
  const candidates = [...new Set(
    (process.env.PATH ?? "")
      .split(delimiter)
      .filter((directory) => directory.length > 0)
      .map((directory) => resolve(directory, executableName)),
  )];
  for (const executable of candidates) {
    try {
      const probe = Bun.spawnSync([
        executable,
        "--input-type=commonjs",
        "-e",
        identityProbe,
      ], {
        env: environment,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      if (probe.exitCode === 0) return executable;
    } catch {
      // Continue past absent, inaccessible, or incompatible PATH candidates.
    }
  }
  throw new Error("package smoke requires a genuine Node 24 executable on PATH");
}

function ssrProbe(release: ReactRelease): string {
  return `import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { Search01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@hraness/ui";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

assert.equal(React.version, ${JSON.stringify(release.version)});

const reactDomPackageUrl = import.meta.resolve("react-dom/package.json");
const reactDomPackage = JSON.parse(await readFile(new URL(reactDomPackageUrl), "utf8"));
assert.equal(reactDomPackage.version, ${JSON.stringify(release.version)});

const stylexCssUrl = import.meta.resolve("@hraness/ui/stylex.css");
assert.equal(new URL(stylexCssUrl).protocol, "file:");
const stylexCss = await readFile(new URL(stylexCssUrl), "utf8");
assert.ok(stylexCss.trim().length > 0, "@hraness/ui/stylex.css must not be empty");

const markup = renderToStaticMarkup(React.createElement(Icon, {
  className: "consumer-icon",
  icon: Search01Icon,
}));
assert.match(markup, /<svg/u);
assert.match(markup, /aria-hidden="true"/u);
assert.match(markup, /class="[^"]*hraness-icon[^"]*consumer-icon[^"]*"/u);
assert.match(markup, /data-slot="icon"/u);
`;
}

const typeScriptProbe = `import { Search01Icon } from "@hugeicons/core-free-icons";
import * as stylex from "@stylexjs/stylex";
import { Icon } from "@hraness/ui";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const styles = stylex.create({ icon: { display: "block" } });
const markup: string = renderToStaticMarkup(createElement(Icon, {
  className: "consumer-icon",
  icon: Search01Icon,
  size: 24,
  strokeWidth: 2,
  xstyle: styles.icon,
}));

void markup;
`;

function typeScriptConfig(moduleResolution: "Bundler" | "NodeNext") {
  return {
    compilerOptions: {
      target: "ES2023",
      lib: ["ES2023", "DOM", "DOM.Iterable"],
      jsx: "react-jsx",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      module: moduleResolution === "Bundler" ? "Preserve" : "NodeNext",
      moduleResolution,
    },
    include: ["index.ts"],
  };
}

async function verifyConsumer(
  archive: string,
  consumer: string,
  nodeExecutable: string,
  release: ReactRelease,
): Promise<void> {
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), `${JSON.stringify({
    name: `hraness-package-smoke-${release.label}`,
    private: true,
    type: "module",
  }, null, 2)}\n`);
  await run([
    process.execPath,
    "add",
    archive,
    "@hugeicons/core-free-icons@^4.2.2",
    "@stylexjs/stylex@0.19.0",
    `@types/react@${release.reactTypes}`,
    `@types/react-dom@${release.reactDomTypes}`,
    `react@${release.version}`,
    `react-dom@${release.version}`,
    "typescript@^6.0.3",
    "--ignore-scripts",
  ], consumer);

  // A restored package-manager cache can retain this valid duplicate topology.
  // Public source types must remain portable when React Aria resolves through it.
  const nestedReactAriaModules = join(
    consumer,
    "node_modules",
    "react-aria",
    "node_modules",
  );
  await mkdir(nestedReactAriaModules, { recursive: true });
  await cp(
    join(consumer, "node_modules", "react-stately"),
    join(nestedReactAriaModules, "react-stately"),
    { recursive: true },
  );

  await writeFile(join(consumer, "ssr.mjs"), ssrProbe(release));
  await run([nodeExecutable, "./ssr.mjs"], consumer);

  await writeFile(join(consumer, "index.ts"), typeScriptProbe);
  for (const moduleResolution of ["Bundler", "NodeNext"] as const) {
    const configName = `tsconfig.${moduleResolution.toLowerCase()}.json`;
    await writeFile(
      join(consumer, configName),
      `${JSON.stringify(typeScriptConfig(moduleResolution), null, 2)}\n`,
    );
    await run([process.execPath, "x", "tsc", "-p", `./${configName}`], consumer);
  }
}

const repository = process.cwd();
const work = await mkdtemp(join(tmpdir(), "hraness-package-smoke-"));
const temporary = join(work, "tmp");
const environment = {
  ...process.env,
  BUN_TMPDIR: temporary,
  TMPDIR: temporary,
};
try {
  const archive = join(work, "package.tgz");
  await mkdir(temporary, { mode: 0o700 });
  const nodeExecutable = resolveGenuineNodeExecutable();
  await run([
    process.execPath,
    "pm",
    "pack",
    "--filename",
    archive,
    "--ignore-scripts",
    "--quiet",
  ], repository);

  for (const release of reactReleases) {
    await verifyConsumer(
      archive,
      join(work, release.label),
      nodeExecutable,
      release,
    );
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
