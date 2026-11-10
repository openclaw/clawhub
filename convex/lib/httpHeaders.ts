export function mergeHeaders(...inits: Array<HeadersInit | undefined>): Record<string, string> {
  const out = new Headers();
  for (const init of inits) {
    if (!init) continue;
    for (const [key, value] of new Headers(init)) {
      out.set(key, value);
    }
  }
  return Object.fromEntries(out.entries());
}

export function corsHeaders(origin: string = "*"): Record<string, string> {
  return { "Access-Control-Allow-Origin": origin };
}

export function json(value: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), {
    status,
    headers: mergeHeaders(
      {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      headers,
      corsHeaders(),
    ),
  });
}
