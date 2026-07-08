import { ipAddress, next } from "@vercel/functions";

const EDGE_SECRET_HEADER = "x-clawhub-edge-secret";
const CLIENT_IP_HEADERS = [
  "cf-connecting-ip",
  "x-forwarded-for",
  "x-real-ip",
  "fly-client-ip",
] as const;

export default function middleware(request: Request): Response {
  const headers = new Headers(request.headers);
  for (const header of CLIENT_IP_HEADERS) headers.delete(header);
  headers.delete(EDGE_SECRET_HEADER);

  const edgeSecret = process.env.CLAWHUB_EDGE_SECRET?.trim();
  const clientIp = ipAddress(request);
  if (edgeSecret && clientIp) {
    headers.set(EDGE_SECRET_HEADER, edgeSecret);
    headers.set("x-forwarded-for", clientIp);
    headers.set("x-real-ip", clientIp);
  }

  return next({ request: { headers } });
}

export const config = {
  matcher: ["/api/:path*", "/v1/feeds/plugins", "/v1/feeds/skills"],
};
