import { extname, resolve } from "node:path";

import { createStylexTransformCollector } from "../build/compiler.js";

const repository = process.cwd();
const sourceRoot = resolve(repository, "src");
const escapedSourceRoot = sourceRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const collector = createStylexTransformCollector(repository);

Bun.plugin({
  name: "hraness-ui-stylex-test-transform",
  setup(build) {
    build.onLoad(
      {
        filter: new RegExp(
          `^${escapedSourceRoot}/.*\\.[cm]?[jt]sx?$`,
          "u",
        ),
      },
      async ({ path }) => {
        const source = await Bun.file(path).text();
        const { code: contents } = await collector.transform(source, path);
        const extension = extname(path);
        const loader = extension === ".tsx"
          ? "tsx"
          : extension === ".ts"
            ? "ts"
            : extension === ".jsx"
              ? "jsx"
              : "js";

        return { contents, loader };
      },
    );
  },
});
