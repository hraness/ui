import { expect, test } from "bun:test";
import { dirname } from "node:path";
import { checkNextDevPrivatePackage } from "./check-next-dev-private-package.js";

test("actual minified package executes its sole startup, loader and manifest owners without compiler globals", async () => {
  const receipt = await checkNextDevPrivatePackage(dirname(import.meta.dir));
  expect(receipt.childCollected).toBe(true);
  expect(receipt.nativeAcceptance).toBe(false);
  console.log(`Constructed packaged development receipt: ${JSON.stringify(receipt)}`);
}, 70_000);
