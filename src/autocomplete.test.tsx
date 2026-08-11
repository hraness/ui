import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Autocomplete,
  ListBox,
  ListBoxItem,
  SearchField,
} from "./index.js";

test("autocomplete composes one search input and list without adding a wrapper", () => {
  const html = renderToStaticMarkup(
    <Autocomplete defaultInputValue="pad">
      <SearchField label="Find a sound" />
      <ListBox aria-label="Sounds" selectionMode="single">
        <ListBoxItem id="piano" textValue="Piano">Piano</ListBoxItem>
        <ListBoxItem id="warm-pad" textValue="Warm pad">Warm pad</ListBoxItem>
      </ListBox>
    </Autocomplete>,
  );

  expect(html).toMatch(
    /^<div\b[^>]*class="hraness-field hraness-search-field"/u,
  );
  expect(html).toContain('aria-autocomplete="list"');
  expect(html).toContain('autoComplete="off"');
  expect(html).toContain('value="pad"');
  expect(html).toContain('class="hraness-list-box"');
  expect(html).not.toContain("react-aria-Autocomplete");
});

test("autocomplete forwards controlled input and product-owned filtering", () => {
  const html = renderToStaticMarkup(
    <Autocomplete
      filter={(textValue, inputValue) => (
        textValue.toLocaleLowerCase("en-US").includes(
          inputValue.toLocaleLowerCase("en-US"),
        )
      )}
      inputValue="piano"
      onInputChange={() => undefined}
    >
      <SearchField label="Find a sound" />
      <ListBox aria-label="Sounds" selectionMode="single">
        <ListBoxItem id="piano" textValue="Piano">Piano</ListBoxItem>
        <ListBoxItem id="warm-pad" textValue="Warm pad">Warm pad</ListBoxItem>
      </ListBox>
    </Autocomplete>,
  );

  expect(html).toContain('value="piano"');
  expect(html).toContain(">Piano</div>");
  expect(html).not.toContain(">Warm pad</div>");
});
