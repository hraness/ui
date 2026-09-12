"use strict";

module.exports = function hranessStylexNextDevCssLoader(source, inputSourceMap) {
  const done = this.async();
  this.cacheable(false);
  const context = this[Symbol.for("@hraness/ui/stylex-next-dev/compilation-v1")];
  if (!context || typeof context.auditNextDevCss !== "function") {
    done(new Error("StyleX Next development stylesheet requires its compilation plugin"));
    return;
  }
  import("./next-dev-session.js").then(({ assertNextDevRuntime }) => {
    assertNextDevRuntime();
    return context.auditNextDevCss(this.resourcePath, source);
  }).then((css) => {
    // The marker becomes a non-presentational sentinel. Its old map cannot
    // describe that replacement, and no ordinary CSS union races native links.
    const map = this.resourcePath === context.preparation.snapshot.cssEntry ? null : inputSourceMap;
    done(null, css, map);
  }, (error) => done(error));
};

module.exports.raw = true;
