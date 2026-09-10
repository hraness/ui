import { HistoryCategoryIcon } from "./category-icon";

/** A second server-authored use of the category icon, as in HistoryEventArticle. */
export function HistoryMeasureKey({ measures }: Readonly<{
  measures: readonly Readonly<{
    id: "payment-volume" | "net-revenue" | "valuation";
    title: string;
    description: string;
  }>[];
}>) {
  return (
    <dl aria-label="Company measure definitions">
      {measures.map(({ id, title, description }) => (
        <div key={id}>
          <dt><HistoryCategoryIcon filterId={id} /> {title}</dt>
          <dd>{description}</dd>
        </div>
      ))}
    </dl>
  );
}
