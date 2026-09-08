import * as stylex from "@stylexjs/stylex";
import { Link } from "@hraness/ui";
import Client from "./client";
import {
  serverMargin,
  sharedDefaultBackground,
  sharedStyles,
  sharedTheme,
  sharedThemeBackground,
} from "./shared.stylex";

export default function Page() {
  return <main {...stylex.props(sharedStyles.surface, sharedStyles.tokenSurface)} data-dev-coherence-root data-dev-server data-dev-expected-background={sharedDefaultBackground} data-dev-expected-margin={`${serverMargin}px`}>
    <h1>Next development compiler fixture</h1>
    <section {...stylex.props(sharedStyles.tokenSurface, sharedTheme)} data-dev-server-theme data-dev-expected-background={sharedThemeBackground}>
      <Link href="/unvisited" xstyle={sharedStyles.link}>Unvisited route</Link>
      <Client />
    </section>
  </main>;
}
