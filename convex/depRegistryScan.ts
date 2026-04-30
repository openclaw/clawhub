import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./functions";
import {
  dedupeDeps,
  depRegistryUrl,
  parseDependencyFile,
  SUPPORTED_DEP_REGISTRIES,
  summarizeDepRegistryChecks,
  type DepEntry,
  type DepRegistryResult,
  type DepRegistryUnresolved,
  type SupportedDepRegistry,
} from "./lib/depRegistryScan";
import { readStorageText } from "./lib/packageRegistry";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 750;
const INTER_REQUEST_DELAY_MS = 100;
const MAX_DEPENDENCIES_PER_SCAN = 120;
const CACHE_TTL_EXISTS_MS = 30 * 24 * 60 * 60 * 1_000;
const CACHE_TTL_NOT_EXISTS_MS = 7 * 24 * 60 * 60 * 1_000;

const registryValidator = v.union(v.literal("pypi"), v.literal("npm"), v.literal("cargo"));

type RegistryCheck =
  | { kind: "found"; httpStatus: number }
  | { kind: "missing"; httpStatus: number }
  | { kind: "unresolved"; reason: string };

function isSupportedRegistry(value: string): value is SupportedDepRegistry {
  return (SUPPORTED_DEP_REGISTRIES as readonly string[]).includes(value);
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkRegistry(dep: DepEntry): Promise<RegistryCheck> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (dep.registry === "cargo") {
    headers["User-Agent"] = "ClawHub-DepRegistryScan/1.0 (https://clawhub.ai)";
  }

  let lastStatus: number | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(depRegistryUrl(dep.registry, dep.name), {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      lastStatus = response.status;
      if (response.status === 200) return { kind: "found", httpStatus: response.status };
      if (response.status === 404) return { kind: "missing", httpStatus: response.status };
      if (response.status !== 429 && response.status < 500) {
        return {
          kind: "unresolved",
          reason: `unexpected HTTP ${response.status}`,
        };
      }
    } catch (error) {
      clearTimeout(timeout);
      if (attempt === MAX_RETRIES) {
        return {
          kind: "unresolved",
          reason: error instanceof Error ? error.message : "network error",
        };
      }
    }

    if (attempt < MAX_RETRIES) {
      await wait(2 ** attempt * BACKOFF_BASE_MS);
    }
  }

  return {
    kind: "unresolved",
    reason: lastStatus ? `HTTP ${lastStatus}` : "network error",
  };
}

async function extractDependencies(ctx: Pick<ActionCtx, "storage">, version: Doc<"skillVersions">) {
  const entries: DepEntry[] = [];
  for (const file of version.files) {
    const basename = file.path.split("/").pop()?.toLowerCase() ?? "";
    if (
      basename !== "requirements.txt" &&
      basename !== "requirements-dev.txt" &&
      basename !== "requirements_dev.txt" &&
      basename !== "requirements-test.txt" &&
      basename !== "requirements_test.txt" &&
      basename !== "package.json" &&
      basename !== "cargo.toml" &&
      basename !== "pyproject.toml"
    ) {
      continue;
    }
    const content = await readStorageText(ctx, file.storageId);
    entries.push(...parseDependencyFile(file.path, content));
  }
  return dedupeDeps(entries);
}

export const lookupCacheInternal = internalQuery({
  args: {
    registry: registryValidator,
    name: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<"depRegistryCache"> | null> => {
    return ctx.db
      .query("depRegistryCache")
      .withIndex("by_registry_name", (q) => q.eq("registry", args.registry).eq("name", args.name))
      .unique();
  },
});

export const upsertCacheInternal = internalMutation({
  args: {
    registry: registryValidator,
    name: v.string(),
    exists: v.boolean(),
    httpStatus: v.number(),
    checkedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("depRegistryCache")
      .withIndex("by_registry_name", (q) => q.eq("registry", args.registry).eq("name", args.name))
      .unique();
    const patch = {
      registry: args.registry,
      name: args.name,
      exists: args.exists,
      httpStatus: args.httpStatus,
      checkedAt: args.checkedAt,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("depRegistryCache", patch);
    }
  },
});

export const getRetryableVersionIdsInternal = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
    const versions = await ctx.db
      .query("skillVersions")
      .withIndex("by_dep_registry_scan_status_and_created", (q) =>
        q.eq("depRegistryScanStatus", "error"),
      )
      .order("desc")
      .take(limit);
    return versions.map((version) => version._id);
  },
});

async function checkWithCache(ctx: ActionCtx, dep: DepEntry) {
  const now = Date.now();
  const cached = (await ctx.runQuery(internal.depRegistryScan.lookupCacheInternal, {
    registry: dep.registry,
    name: dep.name,
  })) as Doc<"depRegistryCache"> | null;
  if (cached) {
    const ttl = cached.exists ? CACHE_TTL_EXISTS_MS : CACHE_TTL_NOT_EXISTS_MS;
    if (now - cached.checkedAt < ttl) {
      return cached.exists
        ? ({ kind: "found", httpStatus: cached.httpStatus } as const)
        : ({ kind: "missing", httpStatus: cached.httpStatus } as const);
    }
  }

  const check = await checkRegistry(dep);
  if (check.kind !== "unresolved") {
    await ctx.runMutation(internal.depRegistryScan.upsertCacheInternal, {
      registry: dep.registry,
      name: dep.name,
      exists: check.kind === "found",
      httpStatus: check.httpStatus,
      checkedAt: now,
    });
  }
  return check;
}

export const checkDependencyRegistries = internalAction({
  args: { versionId: v.id("skillVersions") },
  handler: async (ctx, args) => {
    const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
      versionId: args.versionId,
    })) as Doc<"skillVersions"> | null;
    if (!version) return null;
    if (version.depRegistryAnalysis && version.depRegistryAnalysis.status !== "error") {
      return version.depRegistryAnalysis;
    }

    const deps = await extractDependencies(ctx, version);
    const checkableDeps = deps.slice(0, MAX_DEPENDENCIES_PER_SCAN);
    const deferredDeps = deps.slice(MAX_DEPENDENCIES_PER_SCAN);
    const results: DepRegistryResult[] = [];
    const unresolved: DepRegistryUnresolved[] = deferredDeps.map((dep) => ({
      ...dep,
      reason: "dependency scan limit reached",
    }));

    for (const dep of checkableDeps) {
      if (!isSupportedRegistry(dep.registry)) continue;
      const check = await checkWithCache(ctx, dep);
      if (check.kind === "unresolved") {
        unresolved.push({ ...dep, reason: check.reason });
      } else {
        results.push({
          ...dep,
          exists: check.kind === "found",
          httpStatus: check.httpStatus,
        });
      }
      await wait(INTER_REQUEST_DELAY_MS);
    }

    const analysis = summarizeDepRegistryChecks({
      results,
      unresolved,
      checkedAt: Date.now(),
    });

    await ctx.runMutation(internal.skills.updateVersionDepRegistryAnalysisInternal, {
      versionId: args.versionId,
      depRegistryAnalysis: analysis,
    });

    return analysis;
  },
});

export const rescanErrorDepRegistryVersions = internalAction({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const versionIds = (await ctx.runQuery(
      internal.depRegistryScan.getRetryableVersionIdsInternal,
      { limit: args.batchSize ?? 25 },
    )) as Id<"skillVersions">[];

    let scheduled = 0;
    for (const versionId of versionIds) {
      await ctx.scheduler.runAfter(
        scheduled * 2_000,
        internal.depRegistryScan.checkDependencyRegistries,
        {
          versionId,
        },
      );
      scheduled += 1;
    }
    return { scheduled };
  },
});
