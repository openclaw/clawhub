import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { readInitialPublicPluginPage } from "../../convex/lib/pluginBrowseRead";
import { getRequiredRuntimeEnv } from "./runtimeEnv";

export async function fetchInitialPublicPluginCatalog(signal?: AbortSignal) {
  signal?.throwIfAborted();
  // Keep this client anonymous and cancellation scoped to this navigation.
  const client = new ConvexHttpClient(getRequiredRuntimeEnv("VITE_CONVEX_URL"), {
    fetch: (input, init) => fetch(input, { ...init, signal }),
  });
  const result = await readInitialPublicPluginPage({
    readMetadata: () => client.query(api.publicPluginBrowse.getMetadata, {}),
    fetchPage: (args) => client.query(api.publicPluginFamily.listPage, args),
  });
  signal?.throwIfAborted();
  const items = result.items.map((item) => {
    if (item.family !== "code-plugin" && item.family !== "bundle-plugin") {
      throw new Error("Unexpected family in public plugin catalog");
    }
    return { ...item, family: item.family };
  });
  return { ...result, items };
}
