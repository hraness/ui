import assert from "node:assert/strict";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { normalizeLogicalPath } from "./compiler.js";

export function resolveStylexNextOutputPath(
  passOutputRoot: string,
  compilerOutputPath: string,
  emittedName: string,
): string {
  assert.ok(isAbsolute(passOutputRoot), "StyleX Next pass output root must be absolute");
  assert.ok(isAbsolute(compilerOutputPath), "StyleX Next compiler output path must be absolute");
  const passRoot = resolve(passOutputRoot);
  const compilerRoot = resolve(compilerOutputPath);
  const compilerRelative = relative(passRoot, compilerRoot);
  assert.ok(
    compilerRelative === ""
      || (compilerRelative !== ".." && !compilerRelative.startsWith(`..${sep}`) && !isAbsolute(compilerRelative)),
    "StyleX Next compiler output path escapes the pass output root",
  );
  assert.ok(typeof emittedName === "string" && emittedName.length > 0 && !emittedName.includes("\0"), "StyleX Next emitted asset name is invalid");
  const absolute = resolve(compilerRoot, emittedName);
  const logical = relative(passRoot, absolute).split(sep).join("/");
  assert.ok(
    logical.length > 0 && logical !== ".." && !logical.startsWith("../") && !isAbsolute(logical),
    `StyleX Next emitted asset escapes the pass output root: ${emittedName}`,
  );
  return normalizeLogicalPath(logical, "StyleX Next output asset");
}
