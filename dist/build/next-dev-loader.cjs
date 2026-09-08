"use strict";

module.exports = function hranessStylexNextDevLoader(source, inputSourceMap) {
  const done = this.async();
  this.cacheable(false);
  const preparation = this[Symbol.for("@hraness/ui/stylex-next-dev/compilation-v1")];
  if (!preparation) {
    done(new Error("StyleX Next development loader requires its compilation plugin"));
    return;
  }
  import("./next-dev-session.js").then(({ assertNextDevRuntime, loadNextDevModule }) => {
    assertNextDevRuntime();
    return loadNextDevModule(preparation, this.resourcePath, source, inputSourceMap);
  }).then(({ code, map }) => done(null, code, map), (error) => done(error));
};

module.exports.raw = true;
