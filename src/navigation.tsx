import {
  type AnchorHTMLAttributes,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import { cn } from "./lib/utils.js";

export interface BreadcrumbItem {
  readonly href?: string;
  readonly id: string;
  readonly label: ReactNode;
}

export interface BreadcrumbsProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly "aria-label"?: string;
  readonly items: readonly [BreadcrumbItem, ...BreadcrumbItem[]];
}

/** Ordered page ancestry with an explicit current-page marker. */
export const Breadcrumbs = forwardRef<HTMLElement, BreadcrumbsProps>(
  (
    {
      "aria-label": ariaLabel = "Breadcrumbs",
      className,
      items,
      ...props
    },
    ref,
  ) => (
    <nav
      {...props}
      aria-label={ariaLabel}
      className={cn("hraness-breadcrumbs", className)}
      data-slot="breadcrumbs"
      ref={ref}
    >
      <ol data-slot="breadcrumbs-list">
        {items.map((item, index) => {
          const current = index === items.length - 1;

          return (
            <li data-slot="breadcrumbs-item" key={item.id}>
              {item.href === undefined || current ? (
                <span
                  aria-current={current ? "page" : undefined}
                  data-slot={current
                    ? "breadcrumbs-current"
                    : "breadcrumbs-label"}
                >
                  {item.label}
                </span>
              ) : (
                <a data-slot="breadcrumbs-link" href={item.href}>
                  {item.label}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  ),
);

Breadcrumbs.displayName = "Breadcrumbs";

export type PaginationPart = number | "ellipsis";

const maximumPaginationSiblings = 100;

function positiveInteger(value: number, fallback = 1): number {
  return Number.isFinite(value)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.trunc(value)))
    : fallback;
}

function normalizedPages(
  currentPage: number,
  totalPages: number,
): Readonly<{ current: number; total: number }> {
  const total = positiveInteger(totalPages);
  const current = Math.min(total, positiveInteger(currentPage));

  return { current, total };
}

/** Returns a bounded, ascending page range with explicit gaps. */
export function paginationRange(
  currentPage: number,
  totalPages: number,
  siblings = 1,
): readonly PaginationPart[] {
  const { current, total } = normalizedPages(currentPage, totalPages);
  const radius = Number.isFinite(siblings)
    ? Math.min(
        maximumPaginationSiblings,
        Math.max(0, Math.trunc(siblings)),
      )
    : 1;
  const pages = new Set([1, total]);

  for (let page = current - radius; page <= current + radius; page += 1) {
    if (page > 1 && page < total) pages.add(page);
  }

  if (current <= radius + 2) {
    const edge = Math.min(total - 1, 2 + radius * 2);
    for (let page = 2; page <= edge; page += 1) pages.add(page);
  }

  if (current >= total - radius - 1) {
    const edge = Math.max(2, total - 1 - radius * 2);
    for (let page = edge; page < total; page += 1) pages.add(page);
  }

  const ordered = [...pages].sort((left, right) => left - right);
  const result: PaginationPart[] = [];

  for (const page of ordered) {
    const previous = result.at(-1);
    if (typeof previous === "number" && page - previous > 1) {
      result.push("ellipsis");
    }
    result.push(page);
  }

  return result;
}

export interface PaginationProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly "aria-label"?: string;
  readonly currentPage: number;
  readonly hrefForPage: (page: number) => string;
  readonly siblings?: number;
  readonly totalPages: number;
}

function pageLinkProps(
  page: number,
  current: number,
): AnchorHTMLAttributes<HTMLAnchorElement> {
  return page === current ? { "aria-current": "page" } : {};
}

/** Previous, numbered, and next navigation over a finite page range. */
export const Pagination = forwardRef<HTMLElement, PaginationProps>(
  (
    {
      "aria-label": ariaLabel = "Pagination",
      className,
      currentPage,
      hrefForPage,
      siblings = 1,
      totalPages,
      ...props
    },
    ref,
  ) => {
    const { current, total } = normalizedPages(currentPage, totalPages);
    const parts = paginationRange(current, total, siblings);
    const previous = current - 1;
    const next = current + 1;

    return (
      <nav
        {...props}
        aria-label={ariaLabel}
        className={cn("hraness-pagination", className)}
        data-slot="pagination"
        ref={ref}
      >
        {previous < 1 ? (
          <span
            aria-disabled="true"
            className="hraness-pagination__boundary"
            data-direction="previous"
            data-slot="pagination-previous"
          >
            Previous
          </span>
        ) : (
          <a
            className="hraness-pagination__boundary"
            data-direction="previous"
            data-slot="pagination-previous"
            href={hrefForPage(previous)}
            rel="prev"
          >
            Previous
          </a>
        )}
        <ol data-slot="pagination-list">
          {parts.map((part, index) => (
            <li
              data-slot="pagination-item"
              key={`${String(part)}-${String(index)}`}
            >
              {part === "ellipsis" ? (
                <span
                  aria-hidden="true"
                  className="hraness-pagination__ellipsis"
                  data-slot="pagination-ellipsis"
                >
                  …
                </span>
              ) : (
                <a
                  {...pageLinkProps(part, current)}
                  data-slot="pagination-link"
                  href={hrefForPage(part)}
                >
                  {part}
                </a>
              )}
            </li>
          ))}
        </ol>
        {next > total ? (
          <span
            aria-disabled="true"
            className="hraness-pagination__boundary"
            data-direction="next"
            data-slot="pagination-next"
          >
            Next
          </span>
        ) : (
          <a
            className="hraness-pagination__boundary"
            data-direction="next"
            data-slot="pagination-next"
            href={hrefForPage(next)}
            rel="next"
          >
            Next
          </a>
        )}
      </nav>
    );
  },
);

Pagination.displayName = "Pagination";
