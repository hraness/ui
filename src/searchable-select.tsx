"use client";

import {
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import * as stylex from "@stylexjs/stylex";
import { useObjectRef } from "react-aria/useObjectRef";
import {
  Button,
  ComboBox,
  ComboBoxStateContext,
  Group,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Text,
} from "react-aria-components";
import { fieldStyles } from "./fields.stylex.js";
import { selectFieldStyles } from "./select-field.stylex.js";
import { pickerStyles } from "./searchable-select.stylex.js";
import { rankSelectOptions, type SelectSearchText } from "./select-search.js";
import { cn } from "./lib/utils.js";

export interface SearchableSelectOption<Id extends string = string> extends SelectSearchText {
  readonly id: Id;
  readonly icon?: ReactNode;
  readonly isDisabled?: boolean;
  readonly lang?: string;
}

export interface SearchableSelectProps<Id extends string> {
  readonly label: ReactNode;
  readonly options: readonly SearchableSelectOption<Id>[];
  readonly value: Id | null;
  readonly onChange: (id: Id) => void;
  /** A direct edit (including erasing text), or the end of a search. */
  readonly onQueryChange?: (query: string, reason: "input" | "reset") => void;
  /** Alt+Enter previews the active result while keeping the field open. */
  readonly onPreview?: (id: Id) => void;
  readonly isDisabled?: boolean;
  readonly placeholder?: string;
  readonly emptyText?: string;
  /** The disclosure action. React Aria appends the field label to its accessible name. */
  readonly openLabel?: string;
  readonly description?: ReactNode;
  readonly name?: string;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly className?: string;
  readonly popoverClassName?: string;
}

interface PickerContentsProps<Id extends string> extends SearchableSelectProps<Id> {
  readonly descriptionId: string;
  readonly draft: string | null;
  readonly edit: (text: string) => void;
  readonly ranked: readonly SearchableSelectOption<Id>[];
  readonly selected: SearchableSelectOption<Id> | undefined;
}

function PickerContents<Id extends string>(p: PickerContentsProps<Id>) {
  const state = useContext(ComboBoxStateContext);
  const input = useObjectRef<HTMLInputElement>(p.inputRef);
  const composing = useRef(false);
  const touchPress = useRef<{ x: number; y: number; cancelled: boolean } | null>(null);
  const previousValue = useRef(p.value);
  const wasSearching = useRef(false);
  const isSearching = Boolean(state?.isOpen) || p.draft !== null;
  useEffect(() => {
    const element = input.current;
    if (
      wasSearching.current &&
      !isSearching &&
      element &&
      element.ownerDocument.activeElement === element
    ) {
      // Typing again replaces the restored label when focus stays in the field.
      element.select();
    }
    wasSearching.current = isSearching;
  }, [input, isSearching]);

  useEffect(() => {
    const changed = previousValue.current !== p.value;
    previousValue.current = p.value;
    if ((changed || p.isDisabled) && state?.isOpen) state.revert();
  }, [p.value, p.isDisabled, state]);
  const popover = stylex.props(selectFieldStyles.popover, pickerStyles.popup);
  const dialog = input.current?.closest('dialog[open], [aria-modal="true"]');
  return (
    <>
      <Label {...stylex.props(fieldStyles.label)}>{p.label}</Label>
      <Group
        data-slot="searchable-select-control"
        {...stylex.props(
          fieldStyles.control,
          fieldStyles.controlDefault,
          fieldStyles.controlFocusWithinFallback,
          pickerStyles.control,
        )}
      >
        {p.selected?.icon && p.draft === null && (
          <span aria-hidden="true" {...stylex.props(pickerStyles.icon, pickerStyles.leading)}>
            {p.selected.icon}
          </span>
        )}
        <Input
          ref={input}
          {...(p.draft === null && p.selected?.lang ? { lang: p.selected.lang } : {})}
          {...(p.placeholder ? { placeholder: p.placeholder } : {})}
          autoComplete="off"
          spellCheck={false}
          {...(p.onPreview ? { "aria-keyshortcuts": "Alt+Enter" } : {})}
          {...stylex.props(fieldStyles.input, fieldStyles.inputDefault)}
          onFocus={(e) => {
            if (p.draft === null) e.currentTarget.select();
          }}
          onClick={(e) => {
            if (state && !state.isOpen) {
              if (p.draft === null) e.currentTarget.select();
              state.open(null, "manual");
            }
          }}
          onPointerDownCapture={(e) => {
            if (e.pointerType === "touch" && e.isPrimary) {
              touchPress.current = { x: e.clientX, y: e.clientY, cancelled: false };
            }
          }}
          onPointerMoveCapture={(e) => {
            const press = touchPress.current;
            if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) {
              press.cancelled = true;
            }
          }}
          onPointerCancelCapture={() => {
            if (touchPress.current) touchPress.current.cancelled = true;
          }}
          onContextMenuCapture={() => {
            if (touchPress.current) touchPress.current.cancelled = true;
          }}
          onTouchCancelCapture={() => {
            touchPress.current = null;
          }}
          onTouchEndCapture={(e) => {
            const press = touchPress.current;
            // VoiceOver can send a centered touchend without a pointer. React Aria handles it.
            if (!press || !state || p.isDisabled) return;
            if (e.touches.length > 0) press.cancelled = true;
            else touchPress.current = null;
            if (press.cancelled || e.changedTouches.length !== 1 || p.draft !== null) {
              // Preserve native scrolling and caret placement in an existing draft.
              e.stopPropagation();
              return;
            }
            // WebKit places its caret after the compatibility click, undoing focus-time select().
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.focus({ preventScroll: true });
            e.currentTarget.select();
            if (!state.isOpen) state.open(null, "manual");
          }}
          onChange={(e) => {
            p.edit(e.currentTarget.value);
            if (state && !state.isOpen) state.open(null, "input");
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDownCapture={(e) => {
            if (composing.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
              // Preserve the IME's own candidate navigation and commit.
              if (["Enter", "Escape", "ArrowUp", "ArrowDown"].includes(e.key)) e.stopPropagation();
              return;
            }
            if (!state) return;
            if (
              p.draft !== null &&
              ["ArrowDown", "ArrowUp", "Enter"].includes(e.key) &&
              !p.ranked.some((item) => !item.isDisabled)
            ) {
              // A manual open or commit in React Aria can restore the selected text.
              // There is nothing to navigate or commit while the filtered list is empty.
              e.preventDefault();
              e.stopPropagation();
              if (!state.isOpen) state.open(null, "input");
              return;
            }
            if (!state.isOpen) return;
            if (e.key === "Tab" || e.key === "Escape") {
              // Tab leaves normally. An exploratory arrow press never changes the saved value.
              e.stopPropagation();
              if (e.key === "Escape") e.preventDefault();
              state.revert();
              return;
            }
            if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.shiftKey) return;
            const focused = p.ranked.find(
              (item) => item.id === state.selectionManager.focusedKey && !item.isDisabled,
            );
            const active = focused ?? p.ranked.find((item) => !item.isDisabled);
            if (e.altKey && p.onPreview) {
              e.preventDefault();
              e.stopPropagation();
              if (active) p.onPreview(active.id);
            } else if (!e.altKey && !focused && p.draft !== null && active) {
              e.preventDefault();
              e.stopPropagation();
              state.selectionManager.select(active.id);
            }
          }}
        />
        <Button
          {...(p.openLabel ? { "aria-label": p.openLabel } : {})}
          {...stylex.props(
            fieldStyles.searchClear,
            pickerStyles.disclosure,
            fieldStyles.searchClearNativeInteractions,
          )}
        >
          <svg
            aria-hidden="true"
            focusable="false"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path
              d={state?.isOpen ? "m4 10 4-4 4 4" : "m4 6 4 4 4-4"}
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Button>
      </Group>
      {p.description && (
        <span id={p.descriptionId} slot="description" {...stylex.props(fieldStyles.description)}>
          {p.description}
        </span>
      )}
      <Popover
        data-slot="searchable-select-popover"
        placement="bottom start"
        offset={4}
        {...(dialog ? { UNSTABLE_portalContainer: dialog } : {})}
        {...popover}
        className={cn(popover.className, p.popoverClassName)}
      >
        <ListBox<SearchableSelectOption<Id>>
          {...stylex.props(selectFieldStyles.listBox, pickerStyles.list)}
          renderEmptyState={() => (
            <span role="status" {...stylex.props(pickerStyles.empty)}>
              {p.emptyText ?? "No matches"}
            </span>
          )}
        >
          {(item) => (
            <ListBoxItem
              id={item.id}
              textValue={item.label}
              data-slot="searchable-select-option"
              isDisabled={!!item.isDisabled}
              className={(s) =>
                stylex.props(
                  selectFieldStyles.option,
                  !s.isDisabled && s.isHovered && pickerStyles.hovered,
                  !s.isDisabled && s.isFocused && pickerStyles.focused,
                  s.isDisabled && selectFieldStyles.optionDisabled,
                ).className ?? ""
              }
            >
              {(s) => (
                <>
                  <span {...stylex.props(pickerStyles.content)}>
                    {item.icon && (
                      <span
                        aria-hidden="true"
                        {...stylex.props(pickerStyles.icon, s.isFocused && pickerStyles.focusText)}
                      >
                        {item.icon}
                      </span>
                    )}
                    <span {...stylex.props(selectFieldStyles.optionCopy)}>
                      <Text
                        slot="label"
                        lang={item.lang}
                        {...stylex.props(selectFieldStyles.optionLabel)}
                      >
                        {item.label}
                      </Text>
                      {item.description && (
                        <Text
                          slot="description"
                          {...stylex.props(
                            selectFieldStyles.optionDescription,
                            pickerStyles.secondary,
                            s.isFocused && pickerStyles.focusText,
                          )}
                        >
                          {item.description}
                        </Text>
                      )}
                    </span>
                  </span>
                  {s.isSelected && (
                    <span
                      aria-hidden="true"
                      {...stylex.props(
                        selectFieldStyles.optionCheck,
                        s.isFocused && pickerStyles.focusText,
                      )}
                    >
                      ✓
                    </span>
                  )}
                </>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </>
  );
}

/** A fixed-choice editable picker. Query text and preview never write the selected ID. */
export function SearchableSelect<Id extends string>(p: SearchableSelectProps<Id>) {
  const descriptionId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const currentDraft = useRef<string | null>(null);
  const selected = p.options.find((item) => item.id === p.value);
  const ranked = useMemo(() => rankSelectOptions(p.options, draft ?? ""), [p.options, draft]);
  function changeDraft(next: string | null) {
    if (currentDraft.current === next) return;
    currentDraft.current = next;
    setDraft(next);
    p.onQueryChange?.(next ?? "", next === null ? "reset" : "input");
  }
  const root = stylex.props(fieldStyles.root, p.isDisabled && fieldStyles.disabled);
  return (
    <ComboBox<SearchableSelectOption<Id>>
      data-slot="searchable-select"
      {...root}
      className={cn(root.className, p.className)}
      {...(p.description ? { "aria-describedby": descriptionId } : {})}
      {...(p.name ? { name: p.name } : {})}
      menuTrigger="manual"
      allowsEmptyCollection
      isDisabled={!!p.isDisabled}
      items={ranked}
      value={p.value}
      inputValue={draft ?? selected?.label ?? ""}
      onOpenChange={(open) => {
        if (!open) changeDraft(null);
      }}
      onChange={(key) => {
        const next = p.options.find((item) => item.id === key && !item.isDisabled);
        if (next && next.id !== p.value) p.onChange(next.id);
      }}
    >
      <PickerContents
        {...p}
        descriptionId={descriptionId}
        selected={selected}
        ranked={ranked}
        draft={draft}
        edit={changeDraft}
      />
    </ComboBox>
  );
}
