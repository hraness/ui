import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider, rankSelectOptions, SearchableSelect } from "./index";

const places = [
  { id: "harbor", label: "North Harbor", keywords: ["Quayside"] },
  { id: "station", label: "Harbor Station", description: "Platform 2" },
  { id: "port", label: "Port", keywords: ["Harbor"] },
  { id: "county", label: "Harbor", description: "County" },
  { id: "spanish", label: "A Coruña", lang: "gl" },
  { id: "greek", label: "Αθήνα", keywords: ["Athens"] },
  { id: "chinese", label: "國語", keywords: ["Mandarin"] },
  { id: "lab", label: "Programming" },
];

const ids = (query: string) => rankSelectOptions(places, query).map((item) => item.id);
test("ranking promotes names and exact aliases, and matches multiple terms across fields", () => {
  expect(ids("harbor")[0]).toBe("county");
  expect(ids("harbor").indexOf("port")).toBeLessThan(ids("harbor").indexOf("harbor"));
  expect(ids("platform harb")).toEqual(["station"]);
  expect(ids("PRGRM")).toEqual(["lab"]);
  expect(ids("coruan")).toEqual(["spanish"]);
  expect(ids("CORUNA")).toEqual(["spanish"]);
  expect(ids("o")).not.toContain("chinese");
  expect(ids("國語")).toEqual(["chinese"]);
  expect(ids("Αθηνα")).toEqual(["greek"]);
  expect(ids("definitely absent")).toEqual([]);
  expect(rankSelectOptions(places, "")).toEqual(places);
  expect(rankSelectOptions(places, "Quay")[0]).toBe(places[0]!);
});

test("server renders a labeled editable combobox and its controlled form id", () => {
  const html = renderToStaticMarkup(
    <SearchableSelect
      label="Destination"
      options={places}
      value="spanish"
      name="destination"
      onChange={() => {}}
    />,
  );
  expect(html).toContain('role="combobox"');
  expect(html).toContain("Destination");
  expect(html).toContain('value="A Coruña"');
  expect(html).toMatch(/<input[^>]*lang="gl"/u);
  expect(html).toContain('name="destination"');
  expect(html).toContain('value="spanish"');
});

test("original spelling resolves accent collisions and equally good choices preserve their supplied order", () => {
  const options = [
    { id: "accent", label: "Córdoba" },
    { id: "first", label: "Cordoba" },
    { id: "second", label: "Cordoba" },
    { id: "german", label: "Straße" },
  ] as const;
  expect(rankSelectOptions(options, "cordoba")).toEqual([options[1], options[2], options[0]]);
  expect(rankSelectOptions(options, "CÓRDOBA")[0]).toBe(options[0]!);
  expect(rankSelectOptions(options, "strasse")).toEqual([options[3]!]);
});

test("an externally blank or disabled selection is represented in the server markup", () => {
  const html = renderToStaticMarkup(
    <SearchableSelect
      label="Destination"
      options={places}
      value={null}
      isDisabled
      placeholder="Choose a destination"
      onChange={() => {}}
    />,
  );
  expect(html).toMatch(
    /<input[^>]*disabled[^>]*role="combobox"|<input[^>]*role="combobox"[^>]*disabled/u,
  );
  expect(html).toContain('placeholder="Choose a destination"');
  expect(html).not.toContain('value="A Coruña"');
});

test("the application locale controls React Aria's built-in picker labels", () => {
  const field = (
    <SearchableSelect label="Destination" options={places} value={null} onChange={() => {}} />
  );
  const render = (locale: string) =>
    renderToStaticMarkup(<I18nProvider locale={locale}>{field}</I18nProvider>);
  const disclosure = (html: string) => html.match(/<button[^>]*aria-label="([^"]+)"/u)?.[1];
  expect(disclosure(render("en-US"))).toBeTruthy();
  expect(disclosure(render("ja"))).toBeTruthy();
  expect(disclosure(render("ja"))).not.toBe(disclosure(render("en-US")));
});

test("symbol-only searches match literal labels, aliases and message text", () => {
  const options = [
    { id: "word", label: "Music rehearsal" },
    { id: "exact", label: "🎹" },
    { id: "alias", label: "Keyboard", keywords: ["🎹"] },
    { id: "embedded", label: "We played 🎹 today" },
    { id: "different", label: "🎺" },
    { id: "variation", label: "☕️" },
    { id: "punctuation", label: "C++" },
  ];
  expect(rankSelectOptions(options, "🎹").map((option) => option.id)).toEqual([
    "exact",
    "alias",
    "embedded",
  ]);
  expect(rankSelectOptions(options, "☕").map((option) => option.id)).toEqual(["variation"]);
  expect(rankSelectOptions(options, "++").map((option) => option.id)).toEqual(["punctuation"]);
  expect(rankSelectOptions(options, "🍊")).toEqual([]);
});
