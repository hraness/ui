import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";

export async function resolveFirstBrowserExecutable(
  paths: readonly string[],
  missingMessage: string,
): Promise<string> {
  for (const path of paths) {
    try {
      const target = await realpath(path);
      const stat = await lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      await access(target, constants.X_OK);
      return target;
    } catch {
      // Continue through the repository's supported Chrome and Chromium locations.
    }
  }
  throw new Error(missingMessage);
}
