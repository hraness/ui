import assert from "node:assert/strict";
import type { APIResponse, Route } from "playwright-core";

/** Playwright rethrows rejected route callbacks. Observe them immediately,
 * then collect all handlers after context closure before accepting evidence. */
export function createNextNetworkOwner() {
  const pending = new Set<Promise<void>>();
  const failures: unknown[] = [];
  return {
    run(work: () => Promise<void>): Promise<void> {
      const operation = Promise.resolve().then(work).catch((error: unknown) => {
        if (failures.length < 64) failures.push(error);
      });
      pending.add(operation);
      void operation.then(() => pending.delete(operation));
      return operation;
    },
    async settle(): Promise<void> {
      while (pending.size > 0) await Promise.all([...pending]);
    },
    assertHealthy(): void {
      assert.equal(pending.size, 0, "Network callbacks remain uncollected");
      if (failures.length > 0) throw new AggregateError(failures, "Next native network handlers failed");
    },
    failureCount: () => failures.length,
  };
}

/** Route continuation skips subsequent redirect hops. Fetch exactly one owned
 * response instead, and never hand a redirect to the native browser. */
export async function routeNextDevRequest(route: Route, origin: string, rejected: string[]): Promise<void> {
  const url = new URL(route.request().url());
  if (url.origin !== origin || url.username !== "" || url.password !== "") {
    rejected.push(url.origin);
    await route.abort("blockedbyclient");
    return;
  }
  let response: APIResponse | undefined;
  try {
    response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 30_000 });
    if (response.status() >= 300 && response.status() < 400) {
      rejected.push(`redirect:${url.pathname}:${String(response.status())}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.fulfill({ response });
  } finally {
    await response?.dispose();
  }
}
