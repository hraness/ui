import * as stylex from "@stylexjs/stylex";
import { LinkButton, ThemedSurface } from "@hraness/ui";
import Link from "next/link";

import { HistoryMeasureRail } from "./history-measure-rail";
import { HistoryStickyOffsetSync } from "./history-sticky-offset-sync";
import { historyStyles } from "./shared-history.stylex";

const measures = [
  { id: "payment-volume", title: "Annual payment volume", description: "The value of payments processed during a year.", unit: "US dollars per year" },
  { id: "net-revenue", title: "Net revenue", description: "Revenue after the costs excluded by the reporting definition.", unit: "US dollars per year" },
  { id: "valuation", title: "Valuation", description: "The company value associated with a dated financing or share transaction.", unit: "US dollars at a stated date" },
] as const;

/** The two routes share the real icon, scroll, and resize-observer client boundary. */
export function SharedHistory({ instance }: Readonly<{ instance: "one" | "two" }>) {
  const other = instance === "one" ? "two" : "one";
  return (
    <main
      {...stylex.props(historyStyles.main)}
      className={`stripe-history-history-main ${stylex.props(historyStyles.main).className ?? ""}`}
      data-next-delegated={instance}
    >
      <HistoryStickyOffsetSync />
      <header {...stylex.props(historyStyles.header)} className={`stripe-history-header ${stylex.props(historyStyles.header).className ?? ""}`}>
        <h1>Shared client entry {instance}</h1>
        <p>A company-history interface with shared measure controls.</p>
      </header>
      <nav {...stylex.props(historyStyles.filters)} aria-label="History sections" className={`history-filters ${stylex.props(historyStyles.filters).className ?? ""}`}>
        <ul {...stylex.props(historyStyles.filterList)}>
          <li><a {...stylex.props(historyStyles.filterLink)} aria-current="true" href="#history-measure-payment-volume">Company measures</a></li>
          <li><Link {...stylex.props(historyStyles.filterLink)} href={`/delegated-${other}`}>Second shared history route</Link></li>
        </ul>
      </nav>
      <ThemedSurface as="section" aria-label="Shared company history">
        <p>These cards explain the measures. They do not contain financial observations.</p>
        <HistoryMeasureRail>
          {measures.map(({ id, title, description, unit }) => (
            <figure {...stylex.props(historyStyles.card)} data-measure={id} id={`history-measure-${id}`} key={id}>
              <figcaption><h2>{title}</h2></figcaption>
              <p>{description}</p>
              <dl><dt>Unit</dt><dd>{unit}</dd></dl>
            </figure>
          ))}
        </HistoryMeasureRail>
      </ThemedSurface>
      <nav {...stylex.props(historyStyles.navigation)} aria-label="Adapter fixture">
        <LinkButton href="/">Back to the adapter fixture</LinkButton>
        <Link href={`/delegated-${other}`}>Open shared entry {other}</Link>
      </nav>
    </main>
  );
}
