"use strict";

module.exports = function hranessStylexNextDevCssLoader(source, inputSourceMap) {
  const done = this.async();
  this.cacheable(false);
  const preparation = this[Symbol.for("@hraness/ui/stylex-next-dev/compilation-v1")];
  if (!preparation) {
    done(new Error("StyleX Next development stylesheet requires its compilation plugin"));
    return;
  }
  import("./next-dev-session.js").then(({ assertNextDevRuntime, auditNextDevCss }) => {
    assertNextDevRuntime();
    return auditNextDevCss(preparation, this.resourcePath, source);
  }).then((css) => {
    // The marker is replaced, so an incoming marker map cannot describe its union.
    const map = this.resourcePath === preparation.snapshot.cssEntry ? null : inputSourceMap;
    done(null, css, map);
  }, (error) => done(error));
};

module.exports.raw = true;
