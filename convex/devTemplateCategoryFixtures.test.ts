import { afterEach, describe, expect, it, vi } from "vitest";
import { getTestHandler } from "../src/__tests__/helpers/convexHandler";
import { parseTemplateDocument } from "../src/lib/templateDetail";
import { insert, seed } from "./devTemplateCategoryFixtures";
import { TEMPLATE_CATEGORY_BACKFILL } from "./lib/templateCategoryBackfill";

type SeededListing = { name: string; owner: string; categories: string[] };

afterEach(() => vi.unstubAllEnvs());
describe("local Template category fixture", () => {
  it.each(["prod:production", "dev:cloud", ""])(
    "refuses %s before any storage or database writes",
    async (deployment) => {
      vi.stubEnv("DEV_AUTH_ENABLED", "1");
      vi.stubEnv("CONVEX_DEPLOYMENT", deployment);
      vi.stubEnv("DEV_AUTH_CONVEX_DEPLOYMENT", "");
      vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3661");
      const storage = { store: vi.fn(), delete: vi.fn() };
      const runMutation = vi.fn();
      await expect(getTestHandler<{}>(seed)({ storage, runMutation } as never, {})).rejects.toThrow(
        "Local Template category fixture only",
      );
      expect(storage.store).not.toHaveBeenCalled();
      expect(runMutation).not.toHaveBeenCalled();

      // The mutation is callable on its own, so it carries the same guard.
      // The trigger wrapper binds every writer method, so the mock supplies them all.
      const db = {
        query: vi.fn(),
        get: vi.fn(),
        insert: vi.fn(),
        patch: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        normalizeId: vi.fn(),
      };
      await expect(
        getTestHandler<{ listings: never[] }>(insert)({ db, storage } as never, { listings: [] }),
      ).rejects.toThrow("Local Template category fixture only");
      for (const method of [db.query, db.get, db.insert, db.patch, db.replace, db.delete]) {
        expect(method).not.toHaveBeenCalled();
      }
      expect(storage.delete).not.toHaveBeenCalled();
    },
  );

  it("refuses a local deployment that has not enabled dev auth", async () => {
    vi.stubEnv("DEV_AUTH_ENABLED", "");
    vi.stubEnv("CONVEX_DEPLOYMENT", "local:template-category-test");
    vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3661");
    const storage = { store: vi.fn() };
    await expect(getTestHandler<{}>(seed)({ storage } as never, {})).rejects.toThrow(
      "Local Template category fixture only",
    );
    expect(storage.store).not.toHaveBeenCalled();
  });

  it("stages every mapped listing in its reviewed shape with a manifest that still declares it", async () => {
    vi.stubEnv("DEV_AUTH_ENABLED", "1");
    vi.stubEnv("CONVEX_DEPLOYMENT", "local:template-category-test");
    vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3661");
    const blobs: Blob[] = [];
    const runMutation = vi.fn().mockResolvedValue({ simulated: true, inserted: [], existing: [] });
    await getTestHandler<{}>(seed)(
      {
        storage: {
          store: vi.fn(async (blob: Blob) => {
            blobs.push(blob);
            return "storage:test";
          }),
        },
        runMutation,
      } as never,
      {},
    );
    const listings = runMutation.mock.calls[0]![1].listings as SeededListing[];
    const byName = new Map(listings.map((listing) => [listing.name, listing]));
    expect(byName.size).toBe(listings.length);
    for (const { name, owner, expectedCurrent } of TEMPLATE_CATEGORY_BACKFILL) {
      expect(byName.get(name), name).toMatchObject({ owner, categories: expectedCurrent });
    }
    const firstParty = listings.filter((listing) => listing.owner === "openclaw");
    expect(firstParty.length).toBeGreaterThan(0);
    expect(firstParty.every((listing) => listing.name.startsWith("@openclaw/"))).toBe(true);
    // One unmapped community listing in an old shape keeps the backfill's report non-empty.
    expect(byName.get("@late-publisher/weekend-planner")).toMatchObject({
      owner: "late-publisher",
      categories: ["personal", "productivity"],
    });
    expect(blobs).toHaveLength(listings.length);
    const tutor = listings.findIndex((listing) => listing.name === "tutor");
    expect(parseTemplateDocument(await blobs[tutor]!.text()).manifest).toMatchObject({
      agent: { id: "tutor" },
      categories: ["personal", "research"],
    });
  });
});
