import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

test("Required preserves change-filter skips with Bash only on slim", () => {
  const block = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").split("  required:\n")[1]!;
  const baseline = `    name: Required
    if: always()
    needs: [changes, checks]
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Require every CI job
        env:
          CHANGES: \${{ needs.changes.result }}
          CHECKS: \${{ needs.checks.result }}
          CODE_CHANGED: \${{ needs.changes.outputs.code }}
        run: |
          set -euo pipefail
          [[ "$CHANGES" == success ]]
          if [[ "$CODE_CHANGED" == false ]]; then
            # A deliberate paths-filter skip: only docs no check reads changed.
            [[ "$CHECKS" == skipped ]]
          else
            [[ "$CHECKS" == success ]]
          fi
`;
  expect(block).toBe(baseline.replace("runs-on: ubuntu-latest", "runs-on: ubuntu-slim"));
  const baselineScript = baseline.split("        run: |\n")[1]!.replace(/^          /gm, "");
  const script = block.split("        run: |\n")[1]!.replace(/^          /gm, "");
  const version = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", 'printf "%s" "$BASH_VERSINFO"'], { encoding: "utf8" });
  expect(version.error).toBeUndefined();
  expect(version.status).toBe(0);
  const legacyBash = version.stdout === "3";
  expect(legacyBash && process.platform === "linux").toBe(false);
  let cases = 0;
  let legacyDiscrepancies = 0;
  for (const CHANGES of ["success", "failure", "cancelled", "skipped", ""])
    for (const CHECKS of ["success", "failure", "cancelled", "skipped", ""])
      for (const CODE_CHANGED of ["true", "false", ""]) {
        const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], { env: { PATH: "/nonexistent", CHANGES, CHECKS, CODE_CHANGED }, timeout: 1000 });
        expect(result.error).toBeUndefined();
        const reference = spawnSync("/bin/bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", baselineScript], { env: { PATH: "/nonexistent", CHANGES, CHECKS, CODE_CHANGED }, timeout: 1000 });
        expect(reference.error).toBeUndefined();
        expect(result.status).toBe(reference.status);
        const checksAccepted = CHECKS === (CODE_CHANGED === "false" ? "skipped" : "success");
        const strictAccepted = CHANGES === "success" && checksAccepted;
        expect(result.status === 0).toBe(legacyBash ? checksAccepted : strictAccepted);
        if ((result.status === 0) !== strictAccepted) legacyDiscrepancies++;
        cases++;
      }
  expect(cases).toBe(75);
  expect(legacyDiscrepancies).toBe(legacyBash ? 12 : 0);
});
