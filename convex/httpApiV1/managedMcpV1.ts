import { parseManagedMcpDefinition } from "clawhub-schema";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { applyRateLimit } from "../lib/httpRateLimit";
import {
  json,
  requireAdminOrResponse,
  requireApiTokenUserOrResponse,
  softDeleteErrorToResponse,
  text,
} from "./shared";

export async function managedMcpV1Handler(ctx: ActionCtx, request: Request, segments: string[]) {
  const rate = await applyRateLimit(ctx, request, request.method === "GET" ? "read" : "write");
  if (!rate.ok) return rate.response;
  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;
  const admin = requireAdminOrResponse(auth.user, rate.headers);
  if (!admin.ok) return admin.response;
  try {
    if (request.method === "POST" && segments.length === 2) {
      // Bound the actual stream, not just an optional client-supplied Content-Length.
      const reader = request.body?.getReader();
      if (!reader) return text("Definition required", 400, rate.headers);
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 800_000) return text("Definition exceeds size limit", 413, rate.headers);
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      let definition: unknown;
      try {
        definition = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return text("Invalid definition JSON", 400, rate.headers);
      }
      try {
        definition = parseManagedMcpDefinition(definition);
      } catch (error) {
        return text(
          error instanceof Error ? error.message : "Invalid definition",
          400,
          rate.headers,
        );
      }
      const result = await ctx.runAction(internal.managedMcp.publishForAdminInternal, {
        actorUserId: auth.userId,
        definition,
      });
      return json(result, result.publicationStatus === "pending" ? 202 : 200, rate.headers);
    }
    const id = segments[2];
    if (!id || !/^[a-z][a-z0-9-]{0,62}$/.test(id))
      return text("Invalid integration id", 400, rate.headers);
    if (request.method === "GET" && segments.length === 3) {
      const definition = await ctx.runAction(internal.managedMcp.getDefinitionForAdminInternal, {
        actorUserId: auth.userId,
        id,
      });
      return definition
        ? json(definition, 200, rate.headers)
        : text("Not found", 404, rate.headers);
    }
    if (request.method === "POST" && segments.length === 4 && segments[3] === "unpublish") {
      return json(
        await ctx.runMutation(internal.managedMcp.unpublishForAdminInternal, {
          actorUserId: auth.userId,
          id,
        }),
        200,
        rate.headers,
      );
    }
    return text("Not found", 404, rate.headers);
  } catch (error) {
    return softDeleteErrorToResponse("package", error, rate.headers);
  }
}
