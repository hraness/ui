/** Accept the pinned Playwright server's emitted IPv4 loopback URL verbatim.
 * Its default path is an unguessable 16-byte hex token; never replace that path,
 * normalize another host into loopback, or print the browser-control token. */
export function viteMatrixBrowserEndpoint(value: unknown): string {
  const invalid = () => new Error("Vite matrix browser endpoint must be an exact local IPv4 Playwright WebSocket endpoint");
  if (typeof value !== "string" || value.length > 64) throw invalid();
  const match = /^ws:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/[a-f0-9]{32}$/u.exec(value);
  if (match === null || Number(match[1]) > 65_535) throw invalid();
  return value;
}
