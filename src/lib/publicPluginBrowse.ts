import type { PackageListItem } from "clawhub-schema";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { readInitialPublicPluginPage } from "../../convex/lib/pluginBrowseRead";
import { getRequiredRuntimeEnv } from "./runtimeEnv";

function createAnonymousBrowseClient(signal?: AbortSignal) {
  signal?.throwIfAborted();
  // Keep this client anonymous and cancellation scoped to this navigation.
  return new ConvexHttpClient(getRequiredRuntimeEnv("VITE_CONVEX_URL"), {
    fetch: (input, init) => fetch(input, { ...init, signal }),
  });
}

function requirePluginFamily<T extends PackageListItem>(item: T) {
  if (item.family !== "code-plugin" && item.family !== "bundle-plugin") {
    throw new Error("Unexpected family in public plugin catalog");
  }
  return { ...item, family: item.family };
}

export async function fetchInitialPublicPluginCatalog(signal?: AbortSignal) {
  const client = createAnonymousBrowseClient(signal);
  const result = await readInitialPublicPluginPage({
    readMetadata: () => client.query(api.publicPluginBrowse.getMetadata, {}),
    fetchPage: (args) => client.query(api.publicPluginFamily.listPage, args),
  });
  signal?.throwIfAborted();
  const items = result.items.map(requirePluginFamily);
  return { ...result, items };
}

export async function fetchInitialPublicPluginCategory(category: string, signal?: AbortSignal) {
  const client = createAnonymousBrowseClient(signal);
  const result = await client.query(api.publicPluginDiscovery.listInitialPage, { category });
  signal?.throwIfAborted();
  return {
    items: result.page.map(requirePluginFamily),
    nextCursor: result.isDone ? null : result.continueCursor,
    totalCount: null,
  };
}
