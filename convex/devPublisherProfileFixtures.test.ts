import { afterEach, describe, expect, it, vi } from "vitest";
import { getTestHandler } from "../src/__tests__/helpers/convexHandler";
import { seedMixedCatalogPublisher } from "./devPublisherProfileFixtures";

const handler = getTestHandler<Record<string, never>>(seedMixedCatalogPublisher);

afterEach(() => vi.unstubAllEnvs());

describe("local publisher profile fixture", () => {
  it.each(["prod:production", "dev:cloud", ""])(
    "refuses %s before any database read or write",
    async (deployment) => {
      vi.stubEnv("DEV_AUTH_ENABLED", "1");
      vi.stubEnv("CONVEX_DEPLOYMENT", deployment);
      vi.stubEnv("DEV_AUTH_CONVEX_DEPLOYMENT", "");
      vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3661");
      const db = { query: vi.fn(), insert: vi.fn(), get: vi.fn(), normalizeId: vi.fn() };

      await expect(handler({ db } as never, {})).rejects.toThrow(
        "Local publisher profile fixture only",
      );
      expect(db.query).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    },
  );
});
