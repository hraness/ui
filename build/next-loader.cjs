"use strict";

module.exports = function hranessStylexNextLoader(source, inputSourceMap) {
  // Every compilation must produce receipts in its own attempt directory.
  // A cached module would reuse JavaScript without replaying those effects.
  // Leave webpack's dependency and other-loader caches intact.
  this.cacheable(false);
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
