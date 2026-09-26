import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { resolveFirstBrowserExecutable } from "./browser-executable.ts";
import { verifyPortableOpacity } from "./opacity-proof.ts";

const output = process.argv[2];
if (!output) throw Error("Provide a fresh evidence directory");
await mkdir(output, { recursive: false });
const executablePath = await resolveFirstBrowserExecutable([
  ...(process.env.CHROMIUM_EXECUTABLE_PATH ? [process.env.CHROMIUM_EXECUTABLE_PATH] : []),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
], "A native Chromium executable is required");
const browser = await chromium.launch({ executablePath, headless: true, args: process.platform === "linux" ? ["--no-sandbox"] : [] });
try {
  const receipt = await verifyPortableOpacity(browser, await readFile(resolve(import.meta.dir, "../src/tokens.css"), "utf8"));
  await writeFile(resolve(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ passed: true, cases: receipt.cases.length, samples: receipt.cases.reduce((sum, entry) => sum + entry.actual.length, 0), observedLegacyHueLoss: receipt.observedLegacyHueLoss, output }));
} finally { await browser.close(); }
