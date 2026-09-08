import { expect, test } from "bun:test";
import type { Route } from "playwright-core";
import { createNextNetworkOwner, grantNextDevLoopbackPermission, routeNextDevRequest } from "./next-dev-network.ts";

test("native loopback permission is granted only for the exact disposable source origin", async () => {
  const calls: unknown[] = [];
  const context = { grantPermissions: async (permissions: readonly string[], options?: { origin?: string }) => { calls.push({ permissions, options }); } };
  await grantNextDevLoopbackPermission(context, "http://127.0.0.1:4321");
  expect(calls).toEqual([{ permissions: ["local-network-access"], options: { origin: "http://127.0.0.1:4321" } }]);
  for (const origin of ["*", "http://localhost:4321", "https://127.0.0.1:4321", "http://127.0.0.1:0", "http://127.0.0.1:65536",
    "http://127.0.0.1:04321", "http://127.0.0.1:4321/", "http://127.0.0.1:4321?secret=value", "http://name@127.0.0.1:4321", "http://192.168.1.1:4321"]) {
    await expect(grantNextDevLoopbackPermission(context, origin)).rejects.toThrow();
  }
  expect(calls).toHaveLength(1);
  const failure = new Error("permission refused");
  await expect(grantNextDevLoopbackPermission({ grantPermissions: async () => { throw failure; } }, "http://127.0.0.1:4321")).rejects.toBe(failure);
});

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

test("diagnostic observers identify the exact HTTP failure phase without replacing exceptions or cleanup", async () => {
  for (const phase of ["fetch", "redirect-abort", "fulfill", "dispose"] as const) {
    const item = fixture("http://127.0.0.1:4321/", phase === "redirect-abort" ? 302 : 200);
    const error = new Error(`${phase} failed`);
    if (phase === "fetch") item.route.fetch = async () => { throw error; };
    else if (phase === "redirect-abort") item.route.abort = async () => { throw error; };
    else if (phase === "fulfill") item.route.fulfill = async () => { throw error; };
    else item.response.dispose = async () => { throw error; };
    const observed: unknown[] = [];
    const result = await routeNextDevRequest(item.route, "http://127.0.0.1:4321", [], (actualPhase, actualError) => {
      observed.push([actualPhase, actualError]);
      throw new Error("A diagnostic sink must not change transport semantics");
    }).then(() => null, failure => failure as unknown);
    expect(result).toBe(error);
    expect(observed).toEqual([[phase, error]]);
    if (phase === "redirect-abort" || phase === "fulfill") expect(item.calls.at(-1)).toBe("dispose");
  }
  const item = fixture("http://127.0.0.1:4321/", 200);
  const observed: unknown[] = [];
  await routeNextDevRequest(item.route, "http://127.0.0.1:4321", [], (...event) => { observed.push(event); });
  expect(observed).toEqual([]);
});

test("both fulfillment and disposal failures are observed in order while disposal retains its original precedence", async () => {
  const item = fixture("http://127.0.0.1:4321/", 200);
  const fulfill = new Error("fulfill failed"), dispose = new Error("dispose failed");
  item.route.fulfill = async () => { throw fulfill; };
  item.response.dispose = async () => { throw dispose; };
  const observed: unknown[] = [];
  const result = await routeNextDevRequest(item.route, "http://127.0.0.1:4321", [], (phase, error) => { observed.push([phase, error]); })
    .then(() => null, error => error as unknown);
  expect(result).toBe(dispose);
  expect(observed).toEqual([["fulfill", fulfill], ["dispose", dispose]]);
});
