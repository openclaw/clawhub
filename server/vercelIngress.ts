export function isHostedVercelRuntime(environment: string | undefined) {
  return environment === "production" || environment === "preview";
}

// Only Vercel's hosted ingress overwrites these headers. A local request can't vouch for either.
export function trustedVercelClientIp(headers: Headers, environment: string | undefined) {
  if (!isHostedVercelRuntime(environment)) return undefined;
  return (headers.get("x-vercel-forwarded-for") ?? headers.get("x-forwarded-for"))?.trim();
}
