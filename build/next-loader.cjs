"use strict";

module.exports = function hranessStylexNextLoader(source, inputSourceMap) {
  const done = this.async();
  import("./next-loader.js").then(
    ({ transformStylexNextModule }) => transformStylexNextModule({
      inputSourceMap,
      options: this.getOptions(),
      resourcePath: this.resourcePath,
      source,
    }),
  ).then(
    ({ code, map }) => done(null, code, map),
    (error) => done(error),
  );
};

module.exports.raw = true;
