import { expect, test } from "bun:test";
import type { Route } from "playwright-core";
import { createNextNetworkOwner, routeNextDevRequest } from "./next-dev-network.ts";

function fixture(url: string, status: number, fail = false) {
  const calls: unknown[] = [];
  const response = { status: () => status, dispose: async () => { calls.push("dispose"); } };
  const route = {
    request: () => ({ url: () => url }),
    fetch: async (options: unknown) => { calls.push(options); return response; },
    abort: async (reason: string) => { calls.push(reason); },
    fulfill: async (options: unknown) => { calls.push(options); if (fail) throw new Error("fulfill failed"); },
  } as unknown as Route;
  return { calls, response, route };
}
test("native HTTP transport rejects foreign URLs before opening a network request", async () => {
  for (const url of ["https://example.com/path", "http://127.0.0.1:4322/", "http://name@127.0.0.1:4321/"]) {
    const item = fixture(url, 200), rejected: string[] = [];
    await routeNextDevRequest(item.route, "http://127.0.0.1:4321", rejected);
    expect(item.calls).toEqual(["blockedbyclient"]);
    expect(rejected).toHaveLength(1);
  }
});
test("owned redirects cannot reach their next hop or the browser", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const item = fixture("http://127.0.0.1:4321/", status), rejected: string[] = [];
    await routeNextDevRequest(item.route, "http://127.0.0.1:4321", rejected);
    expect(item.calls).toEqual([{ maxRedirects: 0, maxRetries: 0, timeout: 30_000 }, "blockedbyclient", "dispose"]);
    expect(rejected).toEqual([`redirect:/:${String(status)}`]);
  }
});
test("finite native HTTP responses preserve their status/body and release API ownership", async () => {
  for (const status of [200, 404, 500]) {
    const item = fixture("http://127.0.0.1:4321/path", status), rejected: string[] = [];
    await routeNextDevRequest(item.route, "http://127.0.0.1:4321", rejected);
    expect(item.calls).toEqual([{ maxRedirects: 0, maxRetries: 0, timeout: 30_000 }, { response: item.response }, "dispose"]);
    expect(rejected).toEqual([]);
  }
  const failed = fixture("http://127.0.0.1:4321/path", 200, true);
  await expect(routeNextDevRequest(failed.route, "http://127.0.0.1:4321", [])).rejects.toThrow("fulfill failed");
  expect(failed.calls.at(-1)).toBe("dispose");
});
test("route cancellation failures are observed immediately and settled before acceptance", async () => {
  const owner = createNextNetworkOwner();
  let reject: (error: Error) => void = () => { throw new Error("Missing pending handler"); };
  const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
  const observed = owner.run(() => pending);
  expect(() => owner.assertHealthy()).toThrow("uncollected");
  reject(new Error("Context closed during fetch"));
  await observed;
  await owner.settle();
  expect(owner.failureCount()).toBe(1);
  expect(() => owner.assertHealthy()).toThrow(AggregateError);
  const healthy = createNextNetworkOwner();
  await healthy.run(async () => {});
  await healthy.settle();
  expect(() => healthy.assertHealthy()).not.toThrow();
});
