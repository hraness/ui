import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, test } from "bun:test";

import { stylexNextDeliveryEntries } from "./next-contracts.js";
import { STYLEX_NEXT_GENERATED_ENTRY_SOURCE } from "./next-generation.js";
import { runStylexNextBuild, withStylexNext } from "./next.js";

type DeliveryEntryCallback = (context: string, entry: unknown) => void;

function environmentSnapshot(): Readonly<Record<string, string | undefined>> {
  return {
    HRANESS_STYLEX_NEXT_ATTEMPT_DIRECTORY: process.env.HRANESS_STYLEX_NEXT_ATTEMPT_DIRECTORY,
    HRANESS_STYLEX_NEXT_MODE: process.env.HRANESS_STYLEX_NEXT_MODE,
    HRANESS_STYLEX_NEXT_PLAN_SHA256: process.env.HRANESS_STYLEX_NEXT_PLAN_SHA256,
  };
}

function restoreEnvironment(environment: Readonly<Record<string, string | undefined>>): void {
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function deliveryEntryCallback(rootDirectory: string, initialEntry: unknown): DeliveryEntryCallback {
  const attemptDirectory = join(rootDirectory, ".stylex-next", "fixture");
  mkdirSync(join(attemptDirectory, "generated"), { recursive: true });
  writeFileSync(join(attemptDirectory, "generated", "entry.mjs"), STYLEX_NEXT_GENERATED_ENTRY_SOURCE);
  process.env.HRANESS_STYLEX_NEXT_ATTEMPT_DIRECTORY = attemptDirectory;
  process.env.HRANESS_STYLEX_NEXT_MODE = "delivery";
  process.env.HRANESS_STYLEX_NEXT_PLAN_SHA256 = "0".repeat(64);
  const context = { dev: false, isServer: false, webpack: { version: "5.99.0" } } as const;
  const configured = withStylexNext({}, {
    packageManifests: ["node_modules/@hraness/ui/dist/stylex-manifest.json"],
    rootDirectory,
  }) as Readonly<{
    webpack(config: Record<string, unknown>, webpackContext: typeof context): Record<string, unknown>;
  }>;
  const webpackConfig = configured.webpack({ entry: initialEntry }, context);
  assert.equal(webpackConfig.entry, initialEntry, "the config callback must leave Next's pre-injection entry value untouched");
  assert.ok(Array.isArray(webpackConfig.plugins));
  const plugin = webpackConfig.plugins.find((candidate) => (
    typeof candidate === "object"
      && candidate !== null
      && candidate.constructor.name === "StylexNextDeliveryEntryPlugin"
  ));
  assert.ok(plugin !== undefined && "apply" in plugin && typeof plugin.apply === "function");
  let callback: DeliveryEntryCallback | undefined;
  plugin.apply({
    hooks: {
      entryOption: {
        tap(options: Readonly<{ name: string; stage: number }>, value: DeliveryEntryCallback): void {
          assert.deepEqual(options, { name: "StylexNextDeliveryEntryPlugin", stage: -1_000 });
          assert.equal(callback, undefined, "the delivery plugin must register exactly one entry hook");
          callback = value;
        },
      },
    },
  });
  assert.ok(callback !== undefined);
  return callback;
}

describe("StyleX Next production runtime", () => {
  test("appends the delivery entry only to physical App Router stylesheet owners", async () => {
    const generated = "/fixture/generated/entry.mjs";
    const entries = {
      main: "next-main",
      "main-app": { import: ["next-main-app"], layer: "app-pages-browser" },
      "app/_global-error/page": { dependOn: ["main-app"], import: "global-error-route", layer: "app-pages-browser" },
      "app/layout": { dependOn: ["main-app"], import: ["root-layout"], layer: "app-pages-browser" },
      "app/page": { dependOn: ["main-app"], import: "root-page", layer: "app-pages-browser" },
      "app/nested/layout": { dependOn: ["main-app"], import: "nested-layout", layer: "app-pages-browser" },
      "app/global-error": { dependOn: ["main-app"], import: "physical-global-error", layer: "app-pages-browser" },
    } as const;
    const resolved = stylexNextDeliveryEntries(entries, generated) as typeof entries;
    assert.deepEqual(resolved["app/layout"], {
      ...entries["app/layout"], import: ["root-layout", generated],
    });
    assert.deepEqual(resolved["app/global-error"], {
      ...entries["app/global-error"], import: ["physical-global-error", generated],
    });
    for (const name of ["main", "main-app", "app/_global-error/page", "app/page", "app/nested/layout"] as const) {
      assert.equal(resolved[name], entries[name]);
    }
    assert.throws(
      () => stylexNextDeliveryEntries({ ...entries, "app/layout": { ...entries["app/layout"], import: ["root-layout", generated] } }, generated),
      /already references/u,
    );
    assert.throws(
      () => stylexNextDeliveryEntries({ "main-app": "next-main-app", "app/layout": "layout", "app/page": "page", "pages/index": "legacy" }, generated),
      /does not support Pages Router/u,
    );
  });

  test("defers delivery injection until Next exposes its final App Router client entries", () => {
    const environment = environmentSnapshot();
    const rootDirectory = realpathSync(mkdtempSync(join(tmpdir(), "stylex-next-final-entry-")));
    try {
      const initialMain = { import: ["next-main"] };
      const initialMainApp = { import: ["next-main-app"], layer: "app-pages-browser" };
      const callback = deliveryEntryCallback(rootDirectory, {
        main: initialMain,
        "main-app": initialMainApp,
      });
      const generatedEntry = join(rootDirectory, ".stylex-next", "fixture", "generated", "entry.mjs");
      const layoutDependOn = ["main-app"];
      const layoutImports = ["root-layout"];
      const layout = {
        dependOn: layoutDependOn,
        import: layoutImports,
        layer: "app-pages-browser",
        runtime: "root-runtime",
      };
      const globalErrorDependOn = ["main-app"];
      const globalError = {
        dependOn: globalErrorDependOn,
        import: "physical-global-error",
        layer: "app-pages-browser",
      };
      const page = { dependOn: ["main-app"], import: "root-page", layer: "app-pages-browser" };
      const nestedLayout = { dependOn: ["main-app"], import: "nested-layout", layer: "app-pages-browser" };
      const finalEntries: Record<string, unknown> = {
        main: initialMain,
        "main-app": initialMainApp,
        "app/_global-error/page": { dependOn: ["main-app"], import: "synthetic-global-error", layer: "app-pages-browser" },
        "app/global-error": globalError,
        "app/layout": layout,
        "app/nested/layout": nestedLayout,
        "app/page": page,
        "next/dist/client/components/builtin/not-found": "builtin-not-found",
      };
      const names = Object.keys(finalEntries);

      callback(rootDirectory, finalEntries);

      assert.deepEqual(Object.keys(finalEntries), names);
      assert.deepEqual(finalEntries["app/layout"], {
        ...layout,
        import: [...layoutImports, generatedEntry],
      });
      assert.deepEqual(finalEntries["app/global-error"], {
        ...globalError,
        import: ["physical-global-error", generatedEntry],
      });
      const settledLayout = finalEntries["app/layout"] as typeof layout;
      const settledGlobalError = finalEntries["app/global-error"] as Readonly<{
        dependOn: readonly string[];
        import: readonly string[];
        layer: string;
      }>;
      assert.equal(settledLayout.dependOn, layoutDependOn);
      assert.equal(settledLayout.runtime, layout.runtime);
      assert.equal(settledGlobalError.dependOn, globalErrorDependOn);
      for (const [name, entry] of [
        ["main", initialMain],
        ["main-app", initialMainApp],
        ["app/page", page],
        ["app/nested/layout", nestedLayout],
      ] as const) {
        assert.equal(finalEntries[name], entry, `${name} must retain its exact entry identity`);
      }
    } finally {
      restoreEnvironment(environment);
      rmSync(rootDirectory, { force: true, recursive: true });
    }
  });

  test("fails closed only when the final client entry topology lacks a physical root", () => {
    const environment = environmentSnapshot();
    const rootDirectory = realpathSync(mkdtempSync(join(tmpdir(), "stylex-next-missing-final-entry-")));
    try {
      const callback = deliveryEntryCallback(rootDirectory, {
        main: "next-main",
        "main-app": { import: ["next-main-app"], layer: "app-pages-browser" },
      });
      assert.throws(
        () => callback(rootDirectory, {
          main: "next-main",
          "main-app": { import: ["next-main-app"], layer: "app-pages-browser" },
          "app/page": { dependOn: ["main-app"], import: "root-page", layer: "app-pages-browser" },
        }),
        /requires at least one physical App Router root layout entry/u,
      );
      assert.throws(
        () => callback(rootDirectory, async () => ({ "app/layout": "root-layout" })),
        /final client entry map must be an object/u,
      );
      writeFileSync(
        join(rootDirectory, ".stylex-next", "fixture", "generated", "entry.mjs"),
        `${STYLEX_NEXT_GENERATED_ENTRY_SOURCE}// changed after configuration\n`,
      );
      assert.throws(
        () => callback(rootDirectory, {
          "app/layout": { dependOn: ["main-app"], import: "root-layout", layer: "app-pages-browser" },
          "app/page": { dependOn: ["main-app"], import: "root-page", layer: "app-pages-browser" },
          "main-app": { import: ["next-main-app"], layer: "app-pages-browser" },
        }),
        /generated entry bytes changed before injection/u,
      );
    } finally {
      restoreEnvironment(environment);
      rmSync(rootDirectory, { force: true, recursive: true });
    }
  });

  test("keeps Next's webpack callback synchronous and rejects an asynchronous upstream callback", () => {
    const environment = environmentSnapshot();
    process.env.HRANESS_STYLEX_NEXT_ATTEMPT_DIRECTORY = `${process.cwd()}/.stylex-next/fixture`;
    process.env.HRANESS_STYLEX_NEXT_MODE = "discovery";
    process.env.HRANESS_STYLEX_NEXT_PLAN_SHA256 = "0".repeat(64);
    const options = {
      packageManifests: ["node_modules/@hraness/ui/dist/stylex-manifest.json"],
      rootDirectory: process.cwd(),
    } as const;
    const context = { dev: false, isServer: false, webpack: { version: "5.99.0" } } as const;
    try {
      const configured = withStylexNext({}, options) as Readonly<{
        webpack(config: Record<string, unknown>, webpackContext: typeof context): Record<string, unknown>;
      }>;
      const result = configured.webpack({ entry: { main: "./app/page.tsx" } }, context);
      assert.equal(typeof (result as { then?: unknown }).then, "undefined");

      const asynchronous = withStylexNext({
        webpack: async (config: Record<string, unknown>) => config,
      } as never, options) as Readonly<{
        webpack(config: Record<string, unknown>, webpackContext: typeof context): Record<string, unknown>;
      }>;
      assert.throws(
        () => asynchronous.webpack({ entry: { main: "./app/page.tsx" } }, context),
        /rejects asynchronous next\.config webpack callbacks/u,
      );
    } finally {
      restoreEnvironment(environment);
    }
  });

  test("rejects selective Next build arguments instead of receipting a partial lifecycle", async () => {
    await assert.rejects(
      runStylexNextBuild({
        attemptId: "must-not-start",
        nextArguments: ["--experimental-app-only"],
        packageManifests: ["node_modules/@hraness/ui/dist/stylex-manifest.json"],
        rootDirectory: process.cwd(),
      } as never),
      /exact full production build/u,
    );
  });

  test("rejects Bun even when its Node compatibility version has major 24", async () => {
    await assert.rejects(
      runStylexNextBuild({
        attemptId: "must-not-start",
        packageManifests: ["node_modules/@hraness/ui/dist/stylex-manifest.json"],
        requiredSources: {
          client: ["app/client.tsx"],
          edgeRsc: ["app/edge/page.tsx"],
          nodeRsc: ["app/layout.tsx"],
        },
        rootDirectory: process.cwd(),
      }),
      /requires genuine Node/u,
    );
  });

  test("requires an explicit source inventory for all three production targets", async () => {
    await assert.rejects(
      runStylexNextBuild({
        attemptId: "must-not-start",
        packageManifests: ["node_modules/@hraness/ui/dist/stylex-manifest.json"],
        rootDirectory: process.cwd(),
      } as never),
      /requiredSources must be an object/u,
    );
    await assert.rejects(
      runStylexNextBuild({
        attemptId: "must-not-start",
        packageManifests: ["node_modules/@hraness/ui/dist/stylex-manifest.json"],
        requiredSources: { client: [], nodeRsc: [] },
        rootDirectory: process.cwd(),
      } as never),
      /explicitly inventory every production target/u,
    );

    await assert.rejects(
      runStylexNextBuild({
        attemptId: "must-not-start",
        packageManifests: ["node_modules/@hraness/ui/dist/stylex-manifest.json"],
        requiredSources: { client: [], edgeRsc: [], nodeRsc: [] },
        rootDirectory: process.cwd(),
      }),
      /must inventory at least one repository-owned production source/u,
    );
  });
});
