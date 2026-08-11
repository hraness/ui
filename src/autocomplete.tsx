"use client";

import {
  Autocomplete as AriaAutocomplete,
  type AutocompleteProps as AriaAutocompleteProps,
} from "react-aria-components";
import type { ReactElement } from "react";

export type AutocompleteProps<T = object> = AriaAutocompleteProps<T>;

/**
 * Connects one text input to one filterable collection without adding DOM.
 * React Aria keeps focus in the input while arrow keys virtually focus items.
 */
export function Autocomplete<T = object>(
  props: AutocompleteProps<T>,
): ReactElement {
  return <AriaAutocomplete {...props} />;
}
