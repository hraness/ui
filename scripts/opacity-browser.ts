import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { browserExecutableCandidates, browserLaunchOptions, resolveFirstBrowserExecutable, verifyBrowserLaunch } from "./browser-executable.ts";
import { verifyPortableOpacity } from "./opacity-proof.ts";

const output = process.argv[2];
if (!output) throw Error("Provide a fresh evidence directory");
await mkdir(output, { recursive: false });
const executablePath = await resolveFirstBrowserExecutable(
      browserExecutableCandidates(), "Pinned Playwright Chromium or versioned Chrome for Testing is required");
const browser = await chromium.launch({ executablePath, headless: true, ...browserLaunchOptions(process.platform === "linux" ? ["--no-sandbox"] : []) });
try {
  await verifyBrowserLaunch(browser, executablePath);
  const receipt = await verifyPortableOpacity(browser, await readFile(resolve(import.meta.dir, "../src/tokens.css"), "utf8"));
  await writeFile(resolve(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ passed: true, cases: receipt.cases.length, samples: receipt.cases.reduce((sum, entry) => sum + entry.actual.length, 0), observedLegacyHueLoss: receipt.observedLegacyHueLoss, output }));
} finally { await browser.close(); }
