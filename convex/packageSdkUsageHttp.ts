import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { json, text } from "./httpApiV1/shared";

function pagination(url: URL) {
  const requested = Number(url.searchParams.get("limit") ?? 50);
  if (!Number.isSafeInteger(requested) || requested < 1 || requested > 100) return null;
  return {
    cursor: url.searchParams.get("cursor"),
    numItems: requested,
  };
}

function releaseFilter(url: URL) {
  const raw = url.searchParams.get("releasedSince");
  if (raw === null) return {};
  const releasedSince = Number(raw);
  if (
    !raw.trim() ||
    !Number.isSafeInteger(releasedSince) ||
    releasedSince < 0 ||
    releasedSince > 8.64e15
  )
    return null;
  return { releasedSince };
}

export const packageSdkUsageHttp = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key")?.trim();
  if (
    !key ||
    key.length > 1024 ||
    !/^(sdk-module|sdk-export|api-member|runtime-member|hook|manifest-contract):\S.+$/.test(key)
  )
    return text("Provide a canonical SDK usage key", 400);
  const paginationOpts = pagination(url);
  if (!paginationOpts) return text("Limit must be an integer from 1 to 100", 400);
  const filter = releaseFilter(url);
  if (!filter) return text("releasedSince must be a valid Unix timestamp in milliseconds", 400);
  const [usage, coverage] = await Promise.all([
    ctx.runQuery(internal.packageSdkUsage.lookupInternal, { key, paginationOpts, ...filter }),
    ctx.runQuery(internal.packageSdkUsage.coverageInternal, {
      paginationOpts: { cursor: null, numItems: 100 },
      ...filter,
    }),
  ]);
  const coverageUrl =
    filter.releasedSince === undefined
      ? "/api/v1/sdk-usage/coverage"
      : `/api/v1/sdk-usage/coverage?releasedSince=${filter.releasedSince}`;
  return json({ key, ...usage, coverage, coverageUrl });
});

export const packageSdkUsageCoverageHttp = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const paginationOpts = pagination(url);
  if (!paginationOpts) return text("Limit must be an integer from 1 to 100", 400);
  const filter = releaseFilter(url);
  if (!filter) return text("releasedSince must be a valid Unix timestamp in milliseconds", 400);
  return json(
    await ctx.runQuery(internal.packageSdkUsage.coverageInternal, {
      paginationOpts,
      ...filter,
    }),
  );
});

export const packageSdkUsagePluginHttp = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const name = url.searchParams.get("package")?.trim();
  if (!name || name.length > 512) return text("Provide a package name", 400);
  const paginationOpts = pagination(url);
  if (!paginationOpts) return text("Limit must be an integer from 1 to 100", 400);
  const inventory = await ctx.runQuery(internal.packageSdkUsage.pluginInventoryInternal, {
    name,
    paginationOpts,
  });
  return inventory ? json(inventory) : text("Plugin not found", 404);
});
