import type { Register } from "@tanstack/react-router";
import {
  createStartHandler,
  defaultStreamHandler,
  type RequestHandler,
} from "@tanstack/react-start/server";
import { createContentSecurityPolicy, isLocalDevelopmentRequestUrl } from "./lib/securityHeaders";
import { getThemeModeFromCookieHeader } from "./lib/themeCookie";

function createNonce() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}

const fetch = createStartHandler(async (ctx) => {
  const nonce = createNonce();
  ctx.router.update({
    context: {
      ...ctx.router.options.context,
      initialThemeMode: getThemeModeFromCookieHeader(ctx.request.headers.get("cookie")),
    },
    ssr: { nonce },
  });
  ctx.responseHeaders.set(
    "Content-Security-Policy",
    createContentSecurityPolicy(nonce, {
      allowLocalDevelopment: isLocalDevelopmentRequestUrl(ctx.request.url),
    }),
  );
  return defaultStreamHandler(ctx);
});

type ServerEntry = { fetch: RequestHandler<Register> };

function createServerEntry(entry: ServerEntry): ServerEntry {
  return {
    async fetch(...args) {
      return await entry.fetch(...args);
    },
  };
}

export default createServerEntry({ fetch });
