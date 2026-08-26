import {
  type ForwardedRef,
  forwardRef,
  type HTMLAttributes,
  type ImgHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type RefAttributes,
  type TableHTMLAttributes,
} from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";

import { avatarStyles } from "./avatar.stylex.js";
import { mergeStylexInlineStyles } from "./lib/stylex.js";
import { cn } from "./lib/utils.js";

/** Returns one or two Unicode-aware initials, or a stable unknown marker. */
export function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return "?";

  const selected = words.length === 1
    ? words
    : [words[0] ?? "", words.at(-1) ?? ""];

  return selected
    .flatMap((word) => Array.from(word.toUpperCase()).slice(0, 1))
    .join("");
}

export interface AvatarProps extends Omit<
  HTMLAttributes<HTMLSpanElement>,
  "children"
> {
  readonly alt?: string;
  readonly name: string;
  readonly size?: "default" | "large" | "small";
  readonly src?: string;
  /** Typed StyleX presentation applied after the finite size recipe. */
  readonly xstyle?: StyleXStyles;
}

const avatarSizeStyles = {
  default: undefined,
  large: avatarStyles.large,
  small: avatarStyles.small,
} as const satisfies Readonly<
  Record<NonNullable<AvatarProps["size"]>, StyleXStyles | undefined>
>;

/** An image avatar with a deterministic initials fallback. */
export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(
  (
    {
      "aria-label": ariaLabel,
      alt = "",
      className,
      name,
      role,
      size = "default",
      src,
      style,
      title,
      xstyle,
      ...props
    },
    ref,
  ) => {
    const fallbackLabel = ariaLabel ?? (alt === "" ? undefined : alt);
    const imageProps: ImgHTMLAttributes<HTMLImageElement> = { alt, src };
    const presentation = stylex.props(
      avatarStyles.root,
      avatarSizeStyles[size],
      xstyle,
    );
    const fallbackPresentation = stylex.props(
      avatarStyles.child,
      avatarStyles.fallback,
    );
    const imagePresentation = stylex.props(
      avatarStyles.child,
      avatarStyles.image,
    );

    return (
      <span
        {...props}
        {...presentation}
        aria-label={src === undefined ? fallbackLabel : ariaLabel}
        className={cn("hraness-avatar", presentation.className, className)}
        data-size={size}
        data-slot="avatar"
        ref={ref}
        role={role ?? (src === undefined && fallbackLabel !== undefined
          ? "img"
          : undefined)}
        style={mergeStylexInlineStyles(presentation.style, style)}
        title={title ?? name}
      >
        {src === undefined ? (
          <span
            {...fallbackPresentation}
            aria-hidden="true"
            className={cn(
              "hraness-avatar__fallback",
              fallbackPresentation.className,
            )}
            data-slot="avatar-fallback"
          >
            {avatarInitials(name)}
          </span>
        ) : (
          <img
            {...imageProps}
            {...imagePresentation}
            className={cn(
              "hraness-avatar__image",
              imagePresentation.className,
            )}
            data-slot="avatar-image"
          />
        )}
      </span>
    );
  },
);

Avatar.displayName = "Avatar";

export interface DataTableColumn<Row> {
  readonly align?: "center" | "end" | "start";
  readonly cell: (row: Row) => ReactNode;
  readonly header: ReactNode;
  readonly id: string;
}

export interface DataTableProps<Row> extends Omit<
  TableHTMLAttributes<HTMLTableElement>,
  "children"
> {
  readonly caption?: ReactNode;
  readonly columns: readonly [DataTableColumn<Row>, ...DataTableColumn<Row>[]];
  readonly empty?: ReactNode;
  readonly getRowId: (row: Row) => string;
  readonly rows: readonly Row[];
  readonly wrapperClassName?: string;
}

function DataTableInner<Row>(
  {
    caption,
    className,
    columns,
    empty = "No results.",
    getRowId,
    rows,
    wrapperClassName,
    ...props
  }: DataTableProps<Row>,
  ref: ForwardedRef<HTMLTableElement>,
) {
  return (
    <div
      className={cn("hraness-data-table", wrapperClassName)}
      data-slot="data-table-wrapper"
    >
      <table
        {...props}
        className={cn("hraness-data-table__table", className)}
        data-slot="data-table"
        ref={ref}
      >
        {caption === undefined ? null : (
          <caption data-slot="data-table-caption">{caption}</caption>
        )}
        <thead data-slot="data-table-head">
          <tr data-slot="data-table-header-row">
            {columns.map((column) => (
              <th
                data-align={column.align ?? "start"}
                data-slot="data-table-header"
                key={column.id}
                scope="col"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody data-slot="data-table-body">
          {rows.length === 0 ? (
            <tr data-slot="data-table-empty-row">
              <td
                className="hraness-data-table__empty"
                colSpan={columns.length}
                data-slot="data-table-empty"
              >
                {empty}
              </td>
            </tr>
          ) : rows.map((row) => (
            <tr data-slot="data-table-row" key={getRowId(row)}>
              {columns.map((column) => (
                <td
                  data-align={column.align ?? "start"}
                  data-slot="data-table-cell"
                  key={column.id}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ForwardedDataTable = forwardRef(DataTableInner);
ForwardedDataTable.displayName = "DataTable";

export const DataTable = ForwardedDataTable as <Row>(
  props: DataTableProps<Row> & RefAttributes<HTMLTableElement>,
) => ReactElement | null;
