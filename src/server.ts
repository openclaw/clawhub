import type { Register as RouterRegister } from "@tanstack/react-router";
import {
  createStartHandler,
  defaultStreamHandler,
  type RequestHandler,
} from "@tanstack/react-start/server";
import { createContentSecurityPolicy, isLocalDevelopmentRequestUrl } from "./lib/securityHeaders";
import { getThemeModeFromCookieHeader } from "./lib/themeCookie";

declare module "@tanstack/react-start" {
  interface Register {
    server: { requestContext: { nonce?: string } | undefined };
  }
}

function createNonce() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}

const fetch = createStartHandler(async (ctx) => {
  const nonce = ctx.router.options.ssr?.nonce;
  if (!nonce) throw new Error("Missing request CSP nonce");
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

type ServerEntry = { fetch: RequestHandler<RouterRegister> };

function createServerEntry(entry: ServerEntry): ServerEntry {
  return {
    async fetch(request, options) {
      return await entry.fetch(request, {
        ...options,
        context: { ...options?.context, nonce: createNonce() },
      });
    },
  };
}

export default createServerEntry({ fetch });
