export function cleanString(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function getApiBase(eventHost: string | null) {
  const direct = process.env.VITE_CONVEX_SITE_URL?.trim();
  if (direct) return direct;

  const site = process.env.SITE_URL?.trim() || process.env.VITE_SITE_URL?.trim();
  if (site) return site;

  if (eventHost) return `https://${eventHost}`;
  return "https://clawhub.ai";
}
