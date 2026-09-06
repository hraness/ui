import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import type {
  StylexPackageManifestV1,
  StylexRuleV1,
  StylexStandaloneSerializerV1,
} from "./contracts.js";
import {
  artifactForFile,
  auditCssWithoutStandaloneRecipes,
  canonicalJson,
  compilerContract,
  compilerSha256,
  readStylexPackageManifest,
  serializeStylexPackageRules,
  serializeStylexRules,
  sha256,
  stylexRulesSha256,
  validateStylexPackageManifest,
} from "./compiler.js";
import {
  serializeStylexPackageRules as serializeStylexPackageRulesFromPublicBuild,
  type StylexStandaloneSerializerV1 as PublicStylexStandaloneSerializerV1,
} from "./index.js";

const roots: string[] = [];
const rule = ["x-package", { ltr: ".x-package{color:red}" }, 1000] as const satisfies StylexRuleV1;
const uiSerializer = {
  before: [
    "components.hraness-ui.legacy.base",
    "components.hraness-ui.legacy",
  ],
  prefix: "components.hraness-ui",
} as const satisfies StylexStandaloneSerializerV1;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function write(path: string, value: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, { flag: "wx" });
}

function manifestValue(
  prefix = "components.fixture-ui",
): StylexPackageManifestV1 {
  const standaloneSerializer: StylexStandaloneSerializerV1 = {
    before: [`${prefix}.legacy.base`, `${prefix}.legacy`],
    prefix,
  };
  return validateStylexPackageManifest({
    buildTools: [],
    compiler: compilerContract,
    compilerFoundation: "src/compiler-foundation.css",
    compilerSha256,
    kind: "hraness-stylex-package-manifest",
    package: { name: "@fixture/ui", version: "1.0.0" },
    rules: [rule],
    rulesSha256: stylexRulesSha256([rule]),
    runtime: [],
    schemaVersion: 1,
    standaloneCss: { bytes: 0, path: "dist/stylex.css", sha256: sha256("") },
    standaloneSerializer,
    stylesheets: [{ bytes: 0, path: "src/compiler-foundation.css", sha256: sha256("") }],
  });
}

describe("package StyleX compiler contract", () => {
  test("binds the parser repair and enabled media ordering into every package manifest", () => {
    expect(compilerContract.transform.enableMediaQueryOrder).toBeTrue();
    expect(compilerContract.tools.stylexBabelCompatibility).toEqual({
      entry: "lib/index.js",
      patchId: "stylex-0.19.0-token-parser-explicit-eof-v1",
      patchSha256: "4d17ac835421e037788f800035cfe91ee4fdce384ce97529d572015ea4318295",
      patchedSourceBytes: 418119,
      patchedSourceSha256: "32dfd685bf0ccc18c922ac6906cb911b05b081cc00c0fa6e100818d211abd1ba",
      sourceBytes: 418079,
      sourceSha256: "f880cd6733b91557647f1f894dbcbef7102199a112d1e8a6689fcf7b94f736c3",
    });
    const valid = manifestValue();
    const { stylexBabelCompatibility: omitted, ...legacyTools } = compilerContract.tools;
    void omitted;
    const legacyCompiler = { ...compilerContract, tools: legacyTools };
    expect(() => validateStylexPackageManifest({
      ...valid,
      compiler: legacyCompiler,
      compilerSha256: sha256(canonicalJson(legacyCompiler)),
    })).toThrow();
    const unordered = { ...compilerContract, transform: { ...compilerContract.transform, enableMediaQueryOrder: false } };
    expect(() => validateStylexPackageManifest({
      ...valid,
      compiler: unordered,
      compilerSha256: sha256(canonicalJson(unordered)),
    })).toThrow();
  });

  test("serializes standalone rules in their registered namespace without changing the fixed final-union serializer", () => {
    const fixedBefore = serializeStylexRules([rule]);
    const serializer: PublicStylexStandaloneSerializerV1 = {
      before: ["components.fixture-design-kit.legacy.base", "components.fixture-design-kit.legacy"],
      prefix: "components.fixture-design-kit",
    };
    const standalone = serializeStylexPackageRules([rule], serializer);

    expect(standalone).toStartWith(
      "@layer base, components;\n@layer components.fixture-design-kit.legacy.base, components.fixture-design-kit.legacy, components.fixture-design-kit.priority1;",
    );
    expect(standalone).not.toContain("components.hraness-ui");
    expect(serializeStylexPackageRulesFromPublicBuild([rule], serializer)).toBe(standalone);
    expect(serializeStylexRules([rule])).toBe(fixedBefore);
    expect(fixedBefore).toStartWith(
      "@layer base, components;\n@layer components.hraness-ui.legacy.base, components.hraness-ui.legacy, components.hraness-ui.priority1;",
    );
  });

  test("rejects malformed or ambiguous standalone namespaces and preserves the declared legacy order", () => {
    expect(serializeStylexPackageRules([], {
      before: ["components.fixture.legacy.detail", "components.fixture.legacy"],
      prefix: "components.fixture",
    })).toBe(
      "@layer base, components;\n@layer components.fixture.legacy.detail, components.fixture.legacy;\n",
    );

    for (const serializer of [
      { before: ["components.fixture.legacy"], extra: true, prefix: "components.fixture" },
      { before: ["components.legacy"], prefix: "components" },
      { before: ["components.fixture.legacy"], prefix: "base.fixture" },
      { before: ["components.fixture.legacy"], prefix: "components.Fixture" },
      { before: ["components.fixture.legacy"], prefix: "components.fixture.priority1" },
      { before: [], prefix: "components.fixture" },
      { before: ["components.fixture.legacy", "components.fixture.legacy"], prefix: "components.fixture" },
      { before: ["components.other.legacy"], prefix: "components.fixture" },
      { before: ["components.fixture.legacy.priority2"], prefix: "components.fixture" },
    ]) {
      expect(() => serializeStylexPackageRules([], serializer)).toThrow(
        /unknown keys|namespace|normalized|nonempty|unique|descendants|priority/u,
      );
    }
  });

  test("requires one normalized compiler-foundation member in the stylesheet inventory", () => {
    const valid = manifestValue();
    expect(valid.compilerFoundation).toBe("src/compiler-foundation.css");
    expect(valid.standaloneSerializer).toEqual({
      before: ["components.fixture-ui.legacy.base", "components.fixture-ui.legacy"],
      prefix: "components.fixture-ui",
    });

    for (const compilerFoundation of [
      "src/missing.css",
      "src/compiler-foundation.js",
      "../compiler-foundation.css",
    ]) {
      expect(() => validateStylexPackageManifest({
        ...valid,
        compilerFoundation,
      })).toThrow(/compilerFoundation|normalized|root/u);
    }
    expect(() => validateStylexPackageManifest({
      ...valid,
      standaloneSerializer: { ...valid.standaloneSerializer, extra: true },
    })).toThrow(/unknown keys/u);
  });

  test("recomputes standalone CSS semantics even when altered bytes have a matching artifact hash", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "hraness-ui-compiler-manifest-"));
    roots.push(root);
    await write(join(root, "package.json"), '{"name":"@fixture/ui","version":"1.0.0"}\n');
    await write(join(root, "src/compiler-foundation.css"), ".foundation{display:block}\n");
    const standaloneCss = serializeStylexPackageRules([rule], uiSerializer);
    await write(join(root, "dist/stylex.css"), standaloneCss);
    const manifestPath = join(root, "dist/stylex-manifest.json");
    const manifest = validateStylexPackageManifest({
      buildTools: [],
      compiler: compilerContract,
      compilerFoundation: "src/compiler-foundation.css",
      compilerSha256,
      kind: "hraness-stylex-package-manifest",
      package: { name: "@fixture/ui", version: "1.0.0" },
      rules: [rule],
      rulesSha256: stylexRulesSha256([rule]),
      runtime: [],
      schemaVersion: 1,
      standaloneCss: await artifactForFile(root, "dist/stylex.css"),
      standaloneSerializer: uiSerializer,
      stylesheets: [await artifactForFile(root, "src/compiler-foundation.css")],
    });
    await write(manifestPath, `${canonicalJson(manifest)}\n`);
    expect(await readStylexPackageManifest(manifestPath)).toEqual(manifest);

    const alteredCss = `${standaloneCss}\n.altered{display:block}\n`;
    await writeFile(join(root, "dist/stylex.css"), alteredCss);
    const alteredManifest = validateStylexPackageManifest({
      ...manifest,
      standaloneCss: await artifactForFile(root, "dist/stylex.css"),
    });
    await writeFile(manifestPath, `${canonicalJson(alteredManifest)}\n`);
    await expect(readStylexPackageManifest(manifestPath)).rejects.toThrow(
      /differs from its declared rules and serializer/u,
    );
  });

  test("rejects priority layers under each registered package namespace", () => {
    const manifests = [
      manifestValue("components.fixture-ui"),
      validateStylexPackageManifest({
        ...manifestValue("components.fixture-design-kit"),
        package: { name: "@fixture/design-kit", version: "1.0.0" },
      }),
    ];

    expect(() => auditCssWithoutStandaloneRecipes(
      "@layer components.fixture-ui.legacy{.foundation{display:block}}",
      manifests,
    )).not.toThrow();
    for (const css of [
      "@layer components.fixture-ui.priority1;",
      "@layer components.fixture-design-kit.priority2.child;",
      "@layer components.fixture-design-kit{@layer priority3{.other{display:block}}}",
      "@layer components.hraness-ui.priority4;",
    ]) {
      expect(() => auditCssWithoutStandaloneRecipes(css, manifests)).toThrow(
        /independently serialized recipe layer/u,
      );
    }
  });
});
