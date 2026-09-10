"use client";

import { useEffect, useRef } from "react";

/** Keeps sticky measures and hash targets below the responsive filter rows. */
export function HistoryStickyOffsetSync() {
  const markerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const main = markerRef.current?.closest<HTMLElement>(
      ".stripe-history-history-main",
    );
    const filters = main?.querySelector<HTMLElement>(".history-filters");
    const header = main?.querySelector<HTMLElement>(".stripe-history-header");
    const filterList = filters?.querySelector<HTMLElement>("ul");
    const selectedFilter = filters?.querySelector<HTMLElement>(
      'a[aria-current="true"]',
    );
    if (
      main === null
      || main === undefined
      || filters === null
      || filters === undefined
      || header === null
      || header === undefined
      || filterList === null
      || filterList === undefined
      || selectedFilter === null
      || selectedFilter === undefined
    ) {
      return;
    }

    const updateLayout = () => {
      const headerHeight = header.getBoundingClientRect().height;
      main.style.setProperty(
        "--history-header-offset",
        `${headerHeight}px`,
      );
      main.style.setProperty(
        "--history-filter-stack-offset",
        `${headerHeight + filters.getBoundingClientRect().height}px`,
      );
      if (filterList.scrollWidth > filterList.clientWidth + 1) {
        const listRect = filterList.getBoundingClientRect();
        const selectedRect = selectedFilter.getBoundingClientRect();
        filterList.scrollLeft = Math.max(
          0,
          filterList.scrollLeft + selectedRect.left - listRect.left - 4,
        );
      } else {
        filterList.scrollLeft = 0;
      }
    };
    updateLayout();
    const observer = typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(updateLayout);
    observer?.observe(filters);
    observer?.observe(header);
    return () => {
      observer?.disconnect();
      main.style.removeProperty("--history-header-offset");
      main.style.removeProperty("--history-filter-stack-offset");
    };
  }, []);

  return <span aria-hidden="true" hidden ref={markerRef} />;
}
