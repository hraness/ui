import * as stylex from "@stylexjs/stylex";
import {
  sharedDefaultBackground,
  sharedStyles,
  sharedTheme,
  sharedThemeBackground,
} from "../shared.stylex";

export const runtime = "edge";

const edgeMargin = 91.875;
const styles = stylex.create({ surface: { marginLeft: edgeMargin, padding: 24 } });

export default function UnvisitedPage() {
  return <main {...stylex.props(styles.surface, sharedStyles.tokenSurface)} data-dev-coherence-root data-dev-edge data-dev-expected-background={sharedDefaultBackground} data-dev-expected-margin={`${edgeMargin}px`}>
    <h1>Unvisited Edge route</h1>
    <section {...stylex.props(sharedStyles.tokenSurface, sharedTheme)} data-dev-edge-theme data-dev-expected-background={sharedThemeBackground}><a href="/">Return</a></section>
  </main>;
}
