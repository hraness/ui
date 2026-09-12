"use strict";

module.exports = function hranessStylexNextDevLoader(source, inputSourceMap) {
  const done = this.async();
  this.cacheable(false);
  const context = this[Symbol.for("@hraness/ui/stylex-next-dev/compilation-v1")];
  if (!context || typeof context.loadNextDevModule !== "function") {
    done(new Error("StyleX Next development loader requires its compilation plugin"));
    return;
  }
  import("./next-dev-session.js").then(({ assertNextDevRuntime }) => {
    assertNextDevRuntime();
    return context.loadNextDevModule(this.resourcePath, source, inputSourceMap);
  }).then(({ code, map }) => done(null, code, map), (error) => done(error));
};

module.exports.raw = true;
