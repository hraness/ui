import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  truncate,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  revalidateStylexNextOutputSettlement,
  settleStylexNextPrivateOutput,
  STYLEX_NEXT_OUTPUT_MAX_TEXT_BYTES,
  STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
  type StylexNextOutputArtifactV1,
  type StylexNextPrivateSourceMapV1,
} from "./next-output-settlement.js";

const roots: string[] = [];
const ORIGINAL_JAVASCRIPT = "console.log(\"ready\");\n//# sourceMappingURL=app.js.map\n";
const STRIPPED_JAVASCRIPT = "console.log(\"ready\");\n";
const ORIGINAL_CSS = ".ready{color:green}\n/*# sourceMappingURL=site.css.map */\n";
const STRIPPED_CSS = ".ready{color:green}\n";

type Fixture = Readonly<{
  assetPath: string;
  cssPath: string;
  javascriptPath: string;
  outputDirectory: string;
  outputs: readonly StylexNextOutputArtifactV1[];
  privateSourceMaps: readonly StylexNextPrivateSourceMapV1[];
}>;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(() => true, () => false);
}

async function artifactAt(
  outputDirectory: string,
  path: string,
): Promise<StylexNextOutputArtifactV1> {
  const bytes = await readFile(join(outputDirectory, ...path.split("/")));
  const information = await lstat(join(outputDirectory, ...path.split("/")));
  return Object.freeze({ bytes: bytes.byteLength, mode: information.mode & 0o777, path, sha256: sha256(bytes) });
}

async function fixture(
  javascript = ORIGINAL_JAVASCRIPT,
  css = ORIGINAL_CSS,
): Promise<Fixture> {
  const root = await mkdtemp(join(await realpath(tmpdir()), "hraness-ui-next-output-settlement-"));
  roots.push(root);
  const outputDirectory = join(root, ".next");
  const staticDirectory = join(outputDirectory, "static");
  await mkdir(staticDirectory, { recursive: true });
  const javascriptPath = join(staticDirectory, "app.js");
  const cssPath = join(staticDirectory, "site.css");
  const assetPath = join(staticDirectory, "brand.bin");
  await Promise.all([
    writeFile(javascriptPath, javascript, { flag: "wx" }),
    writeFile(`${javascriptPath}.map`, '{"version":3,"sources":["app.tsx"],"mappings":"AAAA"}\n', { flag: "wx" }),
    writeFile(cssPath, css, { flag: "wx" }),
    writeFile(`${cssPath}.map`, '{"version":3,"sources":["site.stylex.ts"],"mappings":"AAAA"}\n', { flag: "wx" }),
    writeFile(assetPath, Buffer.from([0, 1, 2, 3]), { flag: "wx" }),
  ]);
  await Promise.all([
    chmod(javascriptPath, 0o755),
    chmod(`${javascriptPath}.map`, 0o600),
    chmod(cssPath, 0o640),
    chmod(`${cssPath}.map`, 0o600),
    chmod(assetPath, 0o644),
  ]);
  const paths = [
    "static/app.js",
    "static/app.js.map",
    "static/brand.bin",
    "static/site.css",
    "static/site.css.map",
  ];
  const outputs = (await Promise.all(paths.map((path) => artifactAt(outputDirectory, path))))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  const byPath = new Map(outputs.map((item) => [item.path, item]));
  const pair = (mappedOutputPath: string): StylexNextPrivateSourceMapV1 => {
    const map = byPath.get(`${mappedOutputPath}.map`);
    const mappedOutput = byPath.get(mappedOutputPath);
    if (map === undefined || mappedOutput === undefined) throw new Error("Fixture source-map pair is incomplete");
    return Object.freeze({ map, mappedOutput });
  };
  return {
    assetPath,
    cssPath,
    javascriptPath,
    outputDirectory,
    outputs: Object.freeze(outputs),
    privateSourceMaps: Object.freeze([pair("static/app.js"), pair("static/site.css")]),
  };
}

async function uppercaseJavascriptFixture(
  javascript: string,
  uppercaseMap: boolean,
): Promise<Fixture> {
  const context = await fixture(javascript);
  const javascriptPath = join(context.outputDirectory, "static", "app.JS");
  const mapPath = `${javascriptPath}.${uppercaseMap ? "MAP" : "map"}`;
  await rename(context.javascriptPath, javascriptPath);
  await rename(`${context.javascriptPath}.map`, mapPath);
  const paths = [
    "static/app.JS",
    `static/app.JS.${uppercaseMap ? "MAP" : "map"}`,
    "static/brand.bin",
    "static/site.css",
    "static/site.css.map",
  ];
  const outputs = (await Promise.all(paths.map((path) => artifactAt(context.outputDirectory, path))))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  const byPath = new Map(outputs.map((item) => [item.path, item]));
  const pair = (mappedOutputPath: string, sourceMapPath: string): StylexNextPrivateSourceMapV1 => {
    const map = byPath.get(sourceMapPath);
    const mappedOutput = byPath.get(mappedOutputPath);
    if (map === undefined || mappedOutput === undefined) throw new Error("Uppercase fixture source-map pair is incomplete");
    return Object.freeze({ map, mappedOutput });
  };
  return {
    ...context,
    javascriptPath,
    outputs: Object.freeze(outputs),
    privateSourceMaps: Object.freeze([
      pair("static/app.JS", `static/app.JS.${uppercaseMap ? "MAP" : "map"}`),
      pair("static/site.css", "static/site.css.map"),
    ]),
  };
}

describe("StyleX Next private output settlement", () => {
  test("removes exact private maps and records a historical/private and current/public boundary", async () => {
    const context = await fixture();
    const settlement = await settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: context.outputDirectory,
      outputs: context.outputs,
      privateSourceMaps: context.privateSourceMaps,
    });

    expect(settlement.upload).toBe("not-configured");
    expect(settlement.privateSourceMaps).toEqual(context.privateSourceMaps);
    expect(settlement.publicOutputs.map(({ path }) => path)).toEqual([
      "static/app.js",
      "static/brand.bin",
      "static/site.css",
    ]);
    expect(settlement.privateSourceMaps.every(({ map }) => !settlement.publicOutputs.some(({ path }) => path === map.path))).toBe(true);
    expect(settlement.privateSourceMapsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(settlement.publicOutputsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(settlement)).toBe(true);
    expect(Object.isFrozen(settlement.privateSourceMaps[0]?.map)).toBe(true);
    expect(Object.isFrozen(settlement.publicOutputs[0])).toBe(true);
    expect(await exists(`${context.javascriptPath}.map`)).toBe(false);
    expect(await exists(`${context.cssPath}.map`)).toBe(false);
    expect(await readFile(context.javascriptPath, "utf8")).toBe(STRIPPED_JAVASCRIPT);
    expect(await readFile(context.cssPath, "utf8")).toBe(STRIPPED_CSS);
    expect((await lstat(context.javascriptPath)).mode & 0o777).toBe(0o755);
    expect((await lstat(context.cssPath)).mode & 0o777).toBe(0o640);
    expect(settlement.publicDirectories.map(({ path }) => path)).toEqual(["static"]);
    expect(settlement.publicDirectoriesSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await revalidateStylexNextOutputSettlement(context.outputDirectory, settlement)).toEqual(settlement);
  });

  test("strips only real terminal directives and preserves directive-like JavaScript and CSS content", async () => {
    const javascript = [
      'const quoted = "//# sourceMappingURL=quoted.js.map";',
      "const templated = `/*# sourceMappingURL=template.js.map */`;",
      "console.log(quoted, templated);",
      "//# sourceMappingURL=app.js.map",
      "",
    ].join("\n");
    const css = [
      '.ready::before{content:"/*# sourceMappingURL=content.css.map */"}',
      ".raw{background-image:url(/*# sourceMappingURL=site.css.map */)}",
      ".escaped{background-image:u\\72l(/*# sourceMappingURL=site.css.map */)}",
      "/* ordinary text /*# sourceMappingURL=nested.css.map */",
      "/*# sourceMappingURL=site.css.map */",
      "",
      "",
    ].join("\n");
    const context = await fixture(javascript, css);
    await settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: context.outputDirectory,
      outputs: context.outputs,
      privateSourceMaps: context.privateSourceMaps,
    });

    expect(await readFile(context.javascriptPath, "utf8")).toBe(javascript.replace("//# sourceMappingURL=app.js.map\n", ""));
    expect(await readFile(context.cssPath, "utf8")).toBe(css.replace("/*# sourceMappingURL=site.css.map */\n", ""));
  });

  test("classifies textual outputs and private maps case-insensitively", async () => {
    const inline = await uppercaseJavascriptFixture(
      "console.log(\"ready\");\n//# sourceMappingURL=data:application/json,e30=\n",
      false,
    );
    let uploadCalls = 0;
    await expect(settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: inline.outputDirectory,
      outputs: inline.outputs,
      privateSourceMaps: inline.privateSourceMaps,
      upload: async () => { uploadCalls += 1; },
    })).rejects.toThrow("privacy-safe state");
    expect(uploadCalls).toBe(0);
    expect(await exists(`${inline.javascriptPath}.map`)).toBe(false);

    const uppercaseMap = await uppercaseJavascriptFixture(
      "console.log(\"ready\");\n//# sourceMappingURL=app.JS.MAP\n",
      true,
    );
    await expect(settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: uppercaseMap.outputDirectory,
      outputs: uppercaseMap.outputs,
      privateSourceMaps: uppercaseMap.privateSourceMaps.filter(({ map }) => map.path !== "static/app.JS.MAP"),
    })).rejects.toThrow("Every verified .map output must be declared private exactly once");
    expect(await exists(`${uppercaseMap.javascriptPath}.MAP`)).toBe(true);
  });

  test("permits one exact pair-scoped process-and-upload mutation and invokes it once", async () => {
    const context = await fixture();
    let calls = 0;
    const providerJavascript = "console.log(\"ready\");\n//# debugId=provider-id\n//# sourceMappingURL=app.js.map\n";
    const settlement = await settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: context.outputDirectory,
      outputs: context.outputs,
      privateSourceMaps: context.privateSourceMaps,
      upload: async (request) => {
        calls += 1;
        expect(Object.isFrozen(request)).toBe(true);
        expect(Object.isFrozen(request.sourceMaps)).toBe(true);
        expect(Object.isFrozen(request.sourceMaps[0]?.map.artifact)).toBe(true);
        expect(request.sourceMaps.map(({ mappedOutput }) => mappedOutput.artifact.path)).toEqual([
          "static/app.js",
          "static/site.css",
        ]);
        await writeFile(request.sourceMaps[0]?.mappedOutput.absolutePath ?? "", providerJavascript);
        await writeFile(request.sourceMaps[0]?.map.absolutePath ?? "", '{"version":3,"debug_id":"provider-id"}\n');
      },
    });

    expect(calls).toBe(1);
    expect(settlement.upload).toBe("succeeded");
    expect(await readFile(context.javascriptPath, "utf8")).toBe(
      "console.log(\"ready\");\n//# debugId=provider-id\n",
    );
    expect(settlement.privateSourceMaps[0]?.mappedOutput.sha256).toBe(context.privateSourceMaps[0]?.mappedOutput.sha256);
    expect(await exists(`${context.javascriptPath}.map`)).toBe(false);
    expect(await exists(`${context.cssPath}.map`)).toBe(false);
  });

  test("redacts provider failure details, restores mapped bytes, and still reaches privacy", async () => {
    const context = await fixture();
    const secret = "provider-secret-that-must-not-enter-receipts";
    const settlement = await settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: context.outputDirectory,
      outputs: context.outputs,
      privateSourceMaps: context.privateSourceMaps,
      upload: async (request) => {
        await writeFile(
          request.sourceMaps[0]?.mappedOutput.absolutePath ?? "",
          "console.log(\"changed\");\n//# sourceMappingURL=app.js.map\n",
        );
        await writeFile(request.sourceMaps[0]?.map.absolutePath ?? "", `{"token":"${secret}"}\n`);
        throw new Error(secret);
      },
    });

    expect(settlement.upload).toBe("failed");
    expect(JSON.stringify(settlement)).not.toContain(secret);
    expect(await readFile(context.javascriptPath, "utf8")).toBe(STRIPPED_JAVASCRIPT);
    expect(await readFile(context.cssPath, "utf8")).toBe(STRIPPED_CSS);
    expect(await exists(`${context.javascriptPath}.map`)).toBe(false);
    expect(await exists(`${context.cssPath}.map`)).toBe(false);
  });

  test("rejects a postprocessor new path or unrelated-byte mutation after privacy cleanup", async () => {
    for (const mutation of ["new-path", "new-directory", "new-symlink", "unrelated-bytes"] as const) {
      const context = await fixture();
      const unexpectedPath = join(context.outputDirectory, "static", "unexpected.txt");
      const operation = settleStylexNextPrivateOutput({
        scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
        outputDirectory: context.outputDirectory,
        outputs: context.outputs,
        privateSourceMaps: context.privateSourceMaps,
        upload: async (request) => {
          await writeFile(
            request.sourceMaps[0]?.mappedOutput.absolutePath ?? "",
            "console.log(\"provider\");\n//# sourceMappingURL=app.js.map\n",
          );
          if (mutation === "new-path") await writeFile(unexpectedPath, "unexpected\n", { flag: "wx" });
          else if (mutation === "new-directory") await mkdir(unexpectedPath);
          else if (mutation === "new-symlink") await symlink(context.javascriptPath, unexpectedPath);
          else await writeFile(context.assetPath, Buffer.from([9, 9, 9, 9]));
        },
      });
      await expect(operation).rejects.toThrow("outside its exact map/mapped-output scope");
      expect(await exists(`${context.javascriptPath}.map`)).toBe(false);
      expect(await exists(`${context.cssPath}.map`)).toBe(false);
      expect(await readFile(context.javascriptPath, "utf8")).toBe(STRIPPED_JAVASCRIPT);
    }
  });

  test("rejects duplicate, portable-colliding, traversal, and stale verified inputs before upload", async () => {
    const context = await fixture();
    let calls = 0;
    const upload = async (): Promise<void> => {
      calls += 1;
    };
    await expect(settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: context.outputDirectory,
      outputs: context.outputs,
      privateSourceMaps: [context.privateSourceMaps[0]!, context.privateSourceMaps[0]!],
      upload,
    })).rejects.toThrow("map paths must be unique");

    const first = context.outputs[0]!;
    const collision = [...context.outputs, { ...first, path: "STATIC/portable-alias.js" }]
      .sort((left, right) => left.path.localeCompare(right.path, "en"));
    await expect(settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: context.outputDirectory,
      outputs: collision,
      privateSourceMaps: context.privateSourceMaps,
      upload,
    })).rejects.toThrow("case or Unicode-normalization collisions");

    await expect(settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: context.outputDirectory,
      outputs: context.outputs,
      privateSourceMaps: [{
        map: { ...context.privateSourceMaps[0]!.map, path: "../app.js.map" },
        mappedOutput: context.privateSourceMaps[0]!.mappedOutput,
      }],
      upload,
    })).rejects.toThrow("must remain below the output directory");

    const stale = context.outputs.map((item, index) => index === 0 ? { ...item, sha256: "0".repeat(64) } : item);
    await expect(settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: context.outputDirectory,
      outputs: stale,
      privateSourceMaps: context.privateSourceMaps,
      upload,
    })).rejects.toThrow("differs from verified output");
    expect(calls).toBe(0);
  });

  test("rejects symlinks and unexpected or repeated source-map references", async () => {
    const symlinkContext = await fixture();
    await unlink(symlinkContext.assetPath);
    await symlink(symlinkContext.javascriptPath, symlinkContext.assetPath);
    await expect(settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: symlinkContext.outputDirectory,
      outputs: symlinkContext.outputs,
      privateSourceMaps: symlinkContext.privateSourceMaps,
    })).rejects.toThrow("symlink or special entry");

    const wrongReference = await fixture(
      "console.log(\"ready\");\n//# sourceMappingURL=other.js.map\n",
    );
    let invalidUploadCalls = 0;
    await expect(settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: wrongReference.outputDirectory,
      outputs: wrongReference.outputs,
      privateSourceMaps: wrongReference.privateSourceMaps,
      upload: async () => { invalidUploadCalls += 1; },
    })).rejects.toThrow("privacy-safe state");
    expect(invalidUploadCalls).toBe(0);
    expect(await exists(`${wrongReference.javascriptPath}.map`)).toBe(false);

    const repeatedReference = await fixture(
      "//# sourceMappingURL=app.js.map\nconsole.log(\"ready\");\n//# sourceMappingURL=app.js.map\n",
    );
    await expect(settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: repeatedReference.outputDirectory,
      outputs: repeatedReference.outputs,
      privateSourceMaps: repeatedReference.privateSourceMaps,
    })).rejects.toThrow("privacy-safe state");
    expect(await exists(`${repeatedReference.javascriptPath}.map`)).toBe(false);

    for (const javascript of [
      "//# sourceMappingURL=app.js.map\nconsole.log(\"ready\");\n",
      "console.log(\"ready\");\n//# sourceMappingURL=data:application/json,e30=\n",
      "console.log(\"ready\");\n//# sourceMappingURL=\n",
    ]) {
      const invalid = await fixture(javascript);
      await expect(settleStylexNextPrivateOutput({
        scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
        outputDirectory: invalid.outputDirectory,
        outputs: invalid.outputs,
        privateSourceMaps: invalid.privateSourceMaps,
      })).rejects.toThrow("privacy-safe state");
      expect(await exists(`${invalid.javascriptPath}.map`)).toBe(false);
    }
  });

  test("rejects hard-linked mapped outputs and maps before invoking a provider", async () => {
    for (const target of ["mapped-output", "map"] as const) {
      const context = await fixture();
      const source = target === "mapped-output" ? context.javascriptPath : `${context.javascriptPath}.map`;
      const alias = join(context.outputDirectory, "..", `outside-${target}`);
      await link(source, alias);
      const original = await readFile(alias);
      let calls = 0;
      await expect(settleStylexNextPrivateOutput({
        scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
        outputDirectory: context.outputDirectory,
        outputs: context.outputs,
        privateSourceMaps: context.privateSourceMaps,
        upload: async () => { calls += 1; },
      })).rejects.toThrow("exactly one hard link");
      expect(calls).toBe(0);
      expect(await readFile(alias)).toEqual(original);
      expect(await readFile(source)).toEqual(original);
    }
  });

  test("binds modes across provider mutation, settlement, and late revalidation", async () => {
    const providerMode = await fixture();
    await expect(settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: providerMode.outputDirectory,
      outputs: providerMode.outputs,
      privateSourceMaps: providerMode.privateSourceMaps,
      upload: async (request) => chmod(request.sourceMaps[0]!.mappedOutput.absolutePath, 0o600),
    })).rejects.toThrow("outside its exact map/mapped-output scope");
    expect((await lstat(providerMode.javascriptPath)).mode & 0o777).toBe(0o755);
    expect(await exists(`${providerMode.javascriptPath}.map`)).toBe(false);

    const lateMode = await fixture();
    await expect(settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: lateMode.outputDirectory,
      outputs: lateMode.outputs,
      privateSourceMaps: lateMode.privateSourceMaps,
      revalidateBeforeReturn: async () => chmod(lateMode.assetPath, 0o600),
    })).rejects.toThrow("settled public outputs changed");
  });

  test("rejects an oversized sparse mapped output before reading or invoking a provider", async () => {
    const context = await fixture();
    await truncate(context.javascriptPath, STYLEX_NEXT_OUTPUT_MAX_TEXT_BYTES + 1);
    const oversized = {
      ...context.privateSourceMaps[0]!.mappedOutput,
      bytes: STYLEX_NEXT_OUTPUT_MAX_TEXT_BYTES + 1,
      sha256: "0".repeat(64),
    };
    const outputs = context.outputs
      .map((entry) => entry.path === oversized.path ? oversized : entry)
      .sort((left, right) => left.path.localeCompare(right.path, "en"));
    let calls = 0;
    await expect(settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: context.outputDirectory,
      outputs,
      privateSourceMaps: [{ map: context.privateSourceMaps[0]!.map, mappedOutput: oversized }, context.privateSourceMaps[1]!],
      upload: async () => { calls += 1; },
    })).rejects.toThrow("bounded settlement size");
    expect(calls).toBe(0);
  });

  test("revalidation detects later drift, new maps, and pre-return mutation", async () => {
    const driftContext = await fixture();
    const settlement = await settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: driftContext.outputDirectory,
      outputs: driftContext.outputs,
      privateSourceMaps: driftContext.privateSourceMaps,
    });
    await writeFile(driftContext.assetPath, Buffer.from([4, 3, 2, 1]));
    await expect(revalidateStylexNextOutputSettlement(driftContext.outputDirectory, settlement)).rejects.toThrow(
      "settled public outputs changed",
    );
    await writeFile(join(driftContext.outputDirectory, "static", "late.js.map"), "{}\n", { flag: "wx" });
    await expect(revalidateStylexNextOutputSettlement(driftContext.outputDirectory, settlement)).rejects.toThrow(
      "settled public outputs changed",
    );

    const preReturnContext = await fixture();
    await expect(settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: preReturnContext.outputDirectory,
      outputs: preReturnContext.outputs,
      privateSourceMaps: preReturnContext.privateSourceMaps,
      revalidateBeforeReturn: async () => writeFile(preReturnContext.assetPath, Buffer.from([8, 8, 8, 8])),
    })).rejects.toThrow("settled public outputs changed");
    expect(await exists(`${preReturnContext.javascriptPath}.map`)).toBe(false);
    expect(await exists(`${preReturnContext.cssPath}.map`)).toBe(false);
  });

  test("cannot reuse historical pre-settlement evidence after map removal", async () => {
    const context = await fixture();
    await settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: context.outputDirectory,
      outputs: context.outputs,
      privateSourceMaps: context.privateSourceMaps,
    });
    await expect(settleStylexNextPrivateOutput({
      scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
      outputDirectory: context.outputDirectory,
      outputs: context.outputs,
      privateSourceMaps: context.privateSourceMaps,
    })).rejects.toThrow("differs from the verified delivery inventory");
  });
});
