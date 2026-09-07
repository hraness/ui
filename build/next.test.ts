import assert from "node:assert/strict";

import { describe, test } from "bun:test";

import { stylexNextDeliveryEntries } from "./next-contracts.js";
import { runStylexNextBuild, withStylexNext } from "./next.js";

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

  test("keeps Next's webpack callback synchronous and rejects an asynchronous upstream callback", () => {
    const environment = {
      HRANESS_STYLEX_NEXT_ATTEMPT_DIRECTORY: process.env.HRANESS_STYLEX_NEXT_ATTEMPT_DIRECTORY,
      HRANESS_STYLEX_NEXT_MODE: process.env.HRANESS_STYLEX_NEXT_MODE,
      HRANESS_STYLEX_NEXT_PLAN_SHA256: process.env.HRANESS_STYLEX_NEXT_PLAN_SHA256,
    };
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
      for (const [name, value] of Object.entries(environment)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
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
