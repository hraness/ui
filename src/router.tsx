"use client";

import {
  type ComponentProps,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";
import { RouterProvider as AriaRouterProvider } from "react-aria-components";

export type RouterPrefetch = (href: string) => void;

export type RouterProviderProps = ComponentProps<typeof AriaRouterProvider> &
  Readonly<{
    prefetch?: RouterPrefetch;
  }>;

const PrefetchContext = createContext<RouterPrefetch | null>(null);

/** Connects React Aria links to an application router and optional intent prefetching. */
export function RouterProvider({
  children,
  navigate,
  prefetch,
  useHref,
}: RouterProviderProps) {
  const prefetchValue = useMemo(() => prefetch ?? null, [prefetch]);

  return (
    <AriaRouterProvider navigate={navigate} {...(useHref === undefined ? {} : { useHref })}>
      <PrefetchContext.Provider value={prefetchValue}>
        {children}
      </PrefetchContext.Provider>
    </AriaRouterProvider>
  );
}

export function isPrefetchableHref(href: string | undefined): href is string {
  return href !== undefined && href.startsWith("/") && !href.startsWith("//");
}

/** Prefetches each same-application href at most once per mounted link. */
export function useLinkPrefetch(href: string | undefined): () => void {
  const prefetch = useContext(PrefetchContext);
  const prefetchedHrefRef = useRef<string | null>(null);

  return useCallback(() => {
    if (
      prefetch === null
      || !isPrefetchableHref(href)
      || prefetchedHrefRef.current === href
    ) return;

    prefetch(href);
    prefetchedHrefRef.current = href;
  }, [href, prefetch]);
}
