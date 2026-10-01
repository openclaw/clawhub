"use node";

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { inspectPublicMcp, type McpPublicInspection } from "./lib/mcpPublicInspection";

export const inspectEndpointInternal = internalAction({
  args: {
    url: v.string(),
    transport: v.union(v.literal("streamable-http"), v.literal("sse")),
    checkOAuth: v.optional(v.boolean()),
  },
  handler: async (_ctx, args): Promise<McpPublicInspection> =>
    inspectPublicMcp(args.url, args.transport, args.checkOAuth),
});

export const inspectPackageServer = action({
  args: { name: v.string(), version: v.string(), server: v.string() },
  handler: async (ctx, args): Promise<McpPublicInspection> => {
    // Resolve only an accessible immutable release, never an arbitrary caller-supplied URL.
    const result = await ctx.runQuery(api.packages.getVersionByName, {
      name: args.name,
      version: args.version,
    });
    const summary =
      result?.version && "pluginManifestSummary" in result.version
        ? result.version.pluginManifestSummary
        : undefined;
    const server = summary?.mcpServers.find((entry) => entry.name === args.server);
    if (!server?.url || (server.transport !== "streamable-http" && server.transport !== "sse"))
      return { status: "unavailable", observedAt: Date.now() };
    // URLs and versions must share a destination budget; varying paths/query strings
    // cannot multiply the traffic we send to a provider. Anonymous callers also share
    // a global ceiling because actions do not expose a trustworthy client IP.
    for (const [name, key, rate] of [
      ["mcp-public-inspection-global", "all", 100],
      [
        "mcp-public-inspection-host",
        new URL(server.url).hostname.toLowerCase().replace(/\.$/, ""),
        10,
      ],
    ] as const) {
      const budget = await ctx.runMutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, {
        name,
        key,
        config: { kind: "fixed window", rate, period: 60_000, capacity: rate },
      });
      if (!budget.ok) return { status: "unavailable", observedAt: Date.now() };
    }
    const rate = await ctx.runMutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, {
      name: "mcp-public-inspection",
      key: server.url,
      config: { kind: "fixed window", rate: 5, period: 60_000, capacity: 5 },
    });
    if (!rate.ok) return { status: "unavailable", observedAt: Date.now() };
    return inspectPublicMcp(server.url, server.transport);
  },
});
