import type { Register } from "@tanstack/react-router";
import {
  createStartHandler,
  defaultStreamHandler,
  type RequestHandler,
} from "@tanstack/react-start/server";
import { createContentSecurityPolicy, isLocalDevelopmentRequestUrl } from "./lib/securityHeaders";
import { getThemeModeFromCookieHeader } from "./lib/themeCookie";

const fetch = createStartHandler(async (ctx) => {
  const nonce = ctx.router.options.ssr?.nonce;
  if (!nonce) throw new Error("SSR nonce was not initialized");
  ctx.router.update({
    context: {
      ...ctx.router.options.context,
      initialThemeMode: getThemeModeFromCookieHeader(ctx.request.headers.get("cookie")),
    },
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
