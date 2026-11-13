/** Next may use an internal URL hostname; compare the browser Origin to HTTP Host. */
export function isSameOriginRequest(request: Request): boolean {
  const value = request.headers.get("origin");
  if (!value) return false;
  try {
    const origin = new URL(value),
      url = new URL(request.url);
    const host = request.headers.get("host") || url.host;
    return (
      value === origin.origin &&
      ["http:", "https:"].includes(origin.protocol) &&
      origin.protocol === url.protocol &&
      origin.host.toLowerCase() === host.toLowerCase()
    );
  } catch {
    return false;
  }
}
