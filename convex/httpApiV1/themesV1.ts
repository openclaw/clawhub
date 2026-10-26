import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { applyRateLimit } from "../lib/httpRateLimit";
import { json, requireApiTokenUserOrResponse, text } from "./shared";

const MAX_BODY_BYTES = 16_384;

export async function themesV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, request.method === "GET" ? "read" : "write");
  if (!rate.ok) return rate.response;
  const url = new URL(request.url);
  const suffix = url.pathname.slice("/api/v1/themes".length);
  try {
    if (request.method === "GET" && !suffix) {
      const limit = url.searchParams.get("limit") || "24";
      const query = url.searchParams.get("q")?.trim() || undefined;
      const cursor = url.searchParams.get("cursor") || null;
      if (
        !/^\d+$/.test(limit) ||
        Number(limit) < 1 ||
        Number(limit) > 100 ||
        (query?.length ?? 0) > 200 ||
        (cursor?.length ?? 0) > 4096
      )
        return text("Invalid theme pagination or query", 400, rate.headers);
      return json(
        await ctx.runQuery(internal.themes.listInternal, {
          paginationOpts: { numItems: Number(limit), cursor },
          query,
        }),
        200,
        rate.headers,
      );
    }
    if (request.method === "GET" && suffix.startsWith("/")) {
      const segments = suffix.slice(1).split("/").map(decodeURIComponent);
      if (segments.length !== 2 || !segments.every(Boolean))
        return text("Not found", 404, rate.headers);
      const version = url.searchParams.get("version") || undefined;
      if ((version?.length ?? 0) > 64) return text("Invalid theme version", 400, rate.headers);
      const item = await ctx.runQuery(internal.themes.getInternal, {
        owner: segments[0],
        slug: segments[1],
        version,
      });
      return item ? json({ item }, 200, rate.headers) : text("Not found", 404, rate.headers);
    }
    if (request.method === "POST" && !suffix) {
      const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
      if (!auth.ok) return auth.response;
      const reader = request.body?.getReader();
      if (!reader) return text("Theme publication required", 400, rate.headers);
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > MAX_BODY_BYTES)
            return text("Theme publication exceeds 16384 bytes", 413, rate.headers);
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        return text("Invalid theme JSON", 400, rate.headers);
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return text("Invalid theme publication", 400, rate.headers);
      const record = payload as Record<string, unknown>;
      if (
        Object.keys(record).some(
          (key) => !["owner", "name", "version", "definition"].includes(key),
        ) ||
        typeof record.owner !== "string" ||
        typeof record.name !== "string" ||
        typeof record.version !== "string" ||
        record.definition === undefined
      )
        return text("Expected owner, name, version, and definition", 400, rate.headers);
      const result = await ctx.runMutation(internal.themes.publishInternal, {
        apiTokenId: auth.apiTokenId,
        owner: record.owner,
        slug: record.name,
        version: record.version,
        definition: record.definition,
      });
      return json(result, 200, rate.headers);
    }
    return text("Not found", 404, rate.headers);
  } catch (error) {
    if (error instanceof URIError) return text("Invalid theme path", 400, rate.headers);
    if (error instanceof ConvexError && typeof error.data === "string") {
      const message = error.data;
      const status =
        message === "Unauthorized"
          ? 401
          : /access|Forbidden/.test(message)
            ? 403
            : /already exists/.test(message)
              ? 409
              : 400;
      return text(message, status, rate.headers);
    }
    throw error;
  }
}
