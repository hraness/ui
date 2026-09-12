import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotNextFile, snapshotNextPackage } from "./next-dev-inputs.ts";

test("package snapshots bind actual compiled bytes and packed sources, not only their manifest", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "next-package-inputs-")));
  try {
    await mkdir(join(root, "dist"));
    const code = "export const value = 1;\n";
    const css = ".x{color:red}\n";
    const artifact = (path: string, source: string) => ({ path, bytes: Buffer.byteLength(source), sha256: createHash("sha256").update(source).digest("hex") });
    await writeFile(join(root, "package.json"), JSON.stringify({ files: ["dist", "source.ts"] }));
    await writeFile(join(root, "source.ts"), code);
    await writeFile(join(root, "dist/index.js"), code);
    await writeFile(join(root, "dist/stylex.css"), css);
    await writeFile(join(root, "dist/stylex-manifest.json"), JSON.stringify({ runtime: [artifact("dist/index.js", code)], buildTools: [], stylesheets: [], standaloneCss: artifact("dist/stylex.css", css) }));
    const original = await snapshotNextPackage(root);
    await writeFile(join(root, "dist/index.js"), code.replace("1", "2"));
    await expect(snapshotNextPackage(root)).rejects.toThrow();
    await writeFile(join(root, "dist/index.js"), code);
    expect(await snapshotNextPackage(root)).toEqual(original);
    await writeFile(join(root, "source.ts"), code.replace("1", "2"));
    expect(await snapshotNextPackage(root)).not.toEqual(original);
    const archive = join(root, "archive.tgz"); await writeFile(archive, "before");
    const first = await snapshotNextFile(archive);
    await writeFile(archive, "after!");
    expect((await snapshotNextFile(archive)).seal).not.toEqual(first.seal);
    await symlink(archive, join(root, "linked.tgz"));
    await expect(snapshotNextFile(join(root, "linked.tgz"))).rejects.toThrow();
    await expect(snapshotNextFile(archive, 1)).rejects.toThrow();
  } finally { await rm(root, { recursive: true }); }
});

test("native probes reject redirect transport and retain the exact missing-input recovery", async () => {
  const smoke = await readFile(new URL("./next-dev-adopter-smoke.ts", import.meta.url), "utf8");
  const verifier = await readFile(new URL("../fixtures/next-dev-adopter/verify.ts", import.meta.url), "utf8");
  expect(smoke).toContain('redirect: "error"');
  expect(smoke).toContain('context.routeWebSocket("**/*"');
  expect(smoke).toContain('url.pathname === "/_next/webpack-hmr"');
  const probes = [...verifier.matchAll(/request\.get\([^;\n]+/gu)].map(match => match[0]);
  // One cold unvisited-route warm-up, four repair/recovery probes, and one
  // explicit stable-variable restart probe all remain redirect-forbidden.
  expect(probes).toHaveLength(6);
  expect(probes.filter(probe => probe.includes("${origin}/unvisited"))).toHaveLength(1);
  expect(probes.filter(probe => probe.includes('`${origin}/`'))).toHaveLength(5);
  for (const probe of probes) expect(probe).toContain("maxRedirects: 0");
  expect(verifier).toContain('stages.push("missing-resolution-candidate-recovery")');
  expect(verifier).toContain('"app/created-later.tsx"');
});
