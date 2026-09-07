import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({ proof: { borderBlockEndStyle: "solid", borderBlockEndWidth: "31px" } });

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ manifestProof: "manifest-proof" }];
}

export default function IndexManifestProof() {
  return <main {...stylex.props(styles.proof)} data-next-index-manifest="true">Index manifest route</main>;
}
