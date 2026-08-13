import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const directive = '"use client";\n';

async function javascriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".js") ? [path] : [];
  }));
  return nested.flat().sort((left, right) => left.localeCompare(right));
}

for (const path of await javascriptFiles(join(process.cwd(), "dist"))) {
  const source = await readFile(path, "utf8");
  if (!source.startsWith(directive)) await writeFile(path, directive + source);
}
