import { api } from "../../convex/_generated/api";
import { convexHttp } from "../convex/client";

type CatalogDiscoveryCapabilities = {
  apiVersion: 0 | 1;
  canonicalTrendingEnabled: boolean;
};

const LEGACY_CATALOG_DISCOVERY_CAPABILITIES: CatalogDiscoveryCapabilities = {
  apiVersion: 0,
  canonicalTrendingEnabled: false,
};

export async function fetchCatalogDiscoveryCapabilities(): Promise<CatalogDiscoveryCapabilities> {
  try {
    const response = (await convexHttp.query(
      api.rolloutCapabilities.getPublicCapabilities,
      {},
    )) as {
      catalogDiscovery?: { apiVersion?: unknown };
      skillsSh?: { runtimeEnabled?: unknown };
    };
    return {
      apiVersion: response.catalogDiscovery?.apiVersion === 1 ? 1 : 0,
      canonicalTrendingEnabled: response.skillsSh?.runtimeEnabled === true,
    };
  } catch {
    // Older deployments may not expose the capabilities query at all. Treat
    // unknown backends as legacy so a frontend-first release remains usable.
    return LEGACY_CATALOG_DISCOVERY_CAPABILITIES;
  }
}
