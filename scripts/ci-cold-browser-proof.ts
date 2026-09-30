// Verification branch only. This single cold acquisition is not a release gate.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BrowserContext } from "playwright-core";

const root = process.env.COLD_PROOF_ROOT;
if (!root && process.argv[2] === "cleanup") {
  console.log("cold_browser_cleanup", JSON.stringify({ temporaryRootCreated: false }));
  process.exit(0);
}
assert(root, "Missing task-owned temporary root");
assert.equal(dirname(realpathSync(root)), realpathSync(process.env.RUNNER_TEMP!));
assert.match(root.split("/").at(-1)!, /^ui-cold-browser\.[A-Za-z0-9]+$/);
assert(!lstatSync(root).isSymbolicLink());
const browsers = join(root, "browsers");
const profile = join(root, "profile");
assert.equal(process.env.PLAYWRIGHT_BROWSERS_PATH, browsers);
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const mirrorFile = "/etc/apt/apt-mirrors.txt";
const sources = ["/etc/apt/sources.list", mirrorFile, ...readdirSync("/etc/apt/sources.list.d").filter((name) => /\.(list|sources)$/.test(name)).map((name) => join("/etc/apt/sources.list.d", name))].filter(existsSync);
const sourceSnapshot = () => sources.map((path) => ({ path, content: readFileSync(path, "utf8") }));
type PlannedSource = { path: string; content: string; count: number };
const planSources = (): PlannedSource[] => JSON.parse(execFileSync("python3", ["-c", "import json,runpy; from pathlib import Path; h=runpy.run_path('scripts/ci-ubuntu-mirror.py'); print(json.dumps([{'path':str(p),'content':c,'count':n} for p,c,n in h['plan_sources'](Path('/etc/apt'))]))"], { encoding: "utf8" }));

switch (process.argv[2]) {
  case "before": {
    const { chromium } = await import("playwright-core");
    assert(!existsSync(browsers), "Browser directory must start absent");
    assert(!existsSync(chromium.executablePath()), "Pinned executable must start absent");
    assert(chromium.executablePath().startsWith(`${browsers}/`));
    assert(!existsSync(profile));
    const snapshot = sourceSnapshot();
    assert(snapshot.some((source) => source.path.endsWith("ubuntu.sources") && /^URIs:[ \t]*mirror\+file:\/etc\/apt\/apt-mirrors\.txt(?:\s|$)/mi.test(source.content)), "Expected the observed Ubuntu runner's active mirror+file source");
    const mirrorBefore = readFileSync(mirrorFile, "utf8");
    assert.match(mirrorBefore, /^http:\/\/azure\.archive\.ubuntu\.com\/ubuntu\/\tpriority:1$/m);
    const planned = planSources();
    assert(planned.some((source) => source.path === mirrorFile && source.count > 0), "Reviewed helper must plan the active Azure mirror replacement");
    assert(planned.every((source) => sources.includes(source.path)));
    writeFileSync(join(root, "sources-before.json"), JSON.stringify(snapshot));
    writeFileSync(join(root, "sources-planned.json"), JSON.stringify(planned));
    writeFileSync(join(root, "provision-start-ms"), String(Date.now()));
    console.log("cold_browser_before", JSON.stringify({ root, browsers, browserDirectoryAbsent: true, executableAbsent: true, expectedExecutable: chromium.executablePath(), playwrightVersion: require("playwright-core/package.json").version, mirrorBefore, planned: planned.map(({ path, content, count }) => ({ path, sha256: hash(content), count })) }));
    break;
  }
  case "after": {
    const elapsed = Date.now() - Number(readFileSync(join(root, "provision-start-ms"), "utf8"));
    const before = JSON.parse(readFileSync(join(root, "sources-before.json"), "utf8")) as { path: string; content: string }[];
    const planned = JSON.parse(readFileSync(join(root, "sources-planned.json"), "utf8")) as PlannedSource[];
    const aptSettings = execFileSync("sudo", ["apt-config", "shell", "HTTP_TIMEOUT", "Acquire::http::Timeout", "HTTPS_TIMEOUT", "Acquire::https::Timeout", "RETRIES", "Acquire::Retries"], { encoding: "utf8" });
    const mirrorAfter = readFileSync(mirrorFile, "utf8");
    const ubuntuSourceAfter = readFileSync("/etc/apt/sources.list.d/ubuntu.sources", "utf8");
    console.log("cold_browser_acquisition_readback", JSON.stringify({ provisionAndStepTransitionMs: elapsed, aptSettings, mirrorAfter, ubuntuSourceAfter }));
    for (const source of before) {
      // All other source bytes, including signature configuration, stay exact.
      const expected = planned.find((entry) => entry.path === source.path)?.content ?? source.content;
      assert.equal(hash(readFileSync(source.path)), hash(expected));
    }
    assert(!/^[ \t]*https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu\/?(?:\s|$)/m.test(mirrorAfter));
    assert.match(mirrorAfter, /^https:\/\/archive\.ubuntu\.com\/ubuntu\/\tpriority:1$/m);
    assert.deepEqual(planSources(), [], "No active Azure mirror replacement may remain");
    for (const key of ["HTTP_TIMEOUT", "HTTPS_TIMEOUT"]) {
      const value = Number(aptSettings.match(new RegExp(`^${key}='(\\d+)'`, "m"))?.[1]);
      assert(value > 0 && value <= 20, "Effective acquisition timeout must remain bounded");
    }
    assert.match(aptSettings, /^RETRIES='1'$/m);
    console.log("cold_browser_sources_verified", JSON.stringify({ activeAzureMirrorRemoved: true, sourceBytesMatchReviewedHelper: true, otherSourceAndSigningBytesUnchanged: true }));
    break;
  }
  case "smoke": {
    const { chromium } = await import("playwright-core");
    const { ownedChromiumLaunchOptions, verifyOwnedChromium } = await import("./browser-executable");
    const executable = realpathSync(chromium.executablePath());
    assert(executable.startsWith(`${realpathSync(browsers)}/`));
    let context: BrowserContext | undefined;
    const close = async () => { await context?.close(); };
    process.once("SIGTERM", () => { void close().finally(() => process.exit(143)); });
    process.once("SIGINT", () => { void close().finally(() => process.exit(130)); });
    try {
      context = await chromium.launchPersistentContext(profile, { ...ownedChromiumLaunchOptions(executable), timeout: 20_000 });
      const browser = context.browser();
      assert(browser);
      const identity = await verifyOwnedChromium(browser, executable);
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      await page.setContent('<!doctype html><title>Cold browser proof</title><button style="width:100px;height:40px" onclick="this.textContent=\'clicked\'">ready</button>');
      assert.equal(await page.title(), "Cold browser proof");
      assert.equal(await page.locator("button").evaluate((element) => getComputedStyle(element).width), "100px");
      await page.getByRole("button", { name: "ready" }).click();
      assert.equal(await page.getByRole("button", { name: "clicked" }).textContent(), "clicked");
      await close();
      await browser.close();
      assert(!browser.isConnected(), "Owned browser must be disconnected after close");
      console.log("cold_browser_smoke", JSON.stringify({ ...identity, executableInsideFreshDirectory: true, renderAndClick: "passed", browserClosed: true }));
    } finally { await close(); }
    break;
  }
  case "cleanup": {
    // Inspect all process owners before removal, including a download worker
    // whose temporary path appears only in an open descriptor or mapping.
    const live = JSON.parse(execFileSync("sudo", ["python3", "-c", `
import json, os, sys
from pathlib import Path
root = sys.stdin.read()
prefix = (root + '/').encode()
holders = set()
for process in Path('/proc').iterdir():
    if not process.name.isdigit():
        continue
    try:
        if any(prefix in (process / name).read_bytes() for name in ('cmdline', 'maps')):
            holders.add(process.name)
        for link in [process / 'cwd', *list((process / 'fd').iterdir())]:
            try:
                target = os.readlink(link)
                if target == root or target.startswith(root + '/'):
                    holders.add(process.name)
            except (FileNotFoundError, ProcessLookupError):
                pass
    except (FileNotFoundError, ProcessLookupError):
        pass
print(json.dumps(sorted(holders)))
`], { input: root, encoding: "utf8", timeout: 20_000 }));
    assert.deepEqual(live, [], "Refuse to remove the proof root while its browser is running");
    rmSync(root, { recursive: true });
    assert(!existsSync(root));
    console.log("cold_browser_cleanup", JSON.stringify({ root, liveOwnedProcesses: 0, profileRemoved: !existsSync(profile), temporaryRootRemoved: true }));
    break;
  }
  default: throw new Error("Expected before, after, smoke, or cleanup");
}
