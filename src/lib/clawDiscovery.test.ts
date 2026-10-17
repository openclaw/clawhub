import { beforeEach, describe, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("../convex/client", () => ({ convexHttp: { query } }));
import {
  fetchClawDiscovery,
  filterClaws,
  popularClawCategories,
  type ClawListing,
} from "./clawDiscovery";

function claw(name: string, downloads: number, categories: string[]): ClawListing {
  return {
    name,
    displayName: name,
    family: "claw",
    channel: "community",
    isOfficial: false,
    ownerOfficial: false,
    ownerImage: null,
    ownerHandle: "maker",
    summary: "Careful research assistant",
    icon: null,
    runtimeId: null,
    createdAt: 1,
    updatedAt: 1,
    latestVersion: "1.0.0",
    verificationTier: null,
    categories,
    stats: { downloads, installs: 0, stars: 0, versions: 1 },
  };
}

describe("Claw discovery", () => {
  beforeEach(() => {
    query.mockReset();
  });
  it("ranks categories by their total downloads, counts repeated tags once, and ranks their Claws", () => {
    const groups = popularClawCategories([
      claw("a", 500, ["engineering"]),
      claw("b", 400, ["research", "research"]),
      claw("c", 300, ["research"]),
    ]);
    expect(
      groups.map((group) => [group.slug, group.downloads, group.items.map((item) => item.name)]),
    ).toEqual([
      ["research", 700, ["b", "c"]],
      ["engineering", 500, ["a"]],
    ]);
  });
  it("only ranks canonical Claw categories, excluding legacy and uncategorized values", () => {
    expect(
      popularClawCategories([claw("a", 10, ["coding", "other", "__internal", "engineering"])]).map(
        (group) => group.slug,
      ),
    ).toEqual(["engineering"]);
  });
  it("searches names, descriptions and creators within the selected category", () => {
    const items = [claw("Sift", 3, ["research"]), claw("Patch", 2, ["engineering"])];
    expect(filterClaws(items, " maker careful ", "research").map((item) => item.name)).toEqual([
      "Sift",
    ]);
    expect(filterClaws(items, "missing")).toEqual([]);
  });
  it("reads every public page before ranking and keeps real featured selections separate", async () => {
    const a = claw("a", 2, ["research"]),
      b = claw("b", 1, ["engineering"]);
    query.mockImplementation((_ref, args) =>
      Promise.resolve(
        args.highlightedOnly
          ? { page: [b], isDone: true, continueCursor: "" }
          : args.paginationOpts.cursor
            ? { page: [a, b], isDone: true, continueCursor: "" }
            : { page: [a], isDone: false, continueCursor: "next" },
      ),
    );
    await expect(fetchClawDiscovery()).resolves.toEqual({ items: [a, b], featured: [b] });
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.every(([, args]) => args.family === "claw")).toBe(true);
  });
  it("rejects incomplete catalogs instead of presenting sample totals as global popularity", async () => {
    query.mockImplementation((_ref, args) =>
      Promise.resolve({ page: [], isDone: !!args.highlightedOnly, continueCursor: "stuck" }),
    );
    await expect(fetchClawDiscovery()).rejects.toThrow("complete category index");
    expect(query).toHaveBeenCalledTimes(3);
  });
  it("does not turn a failed featured request into an empty featured collection", async () => {
    query.mockRejectedValue(new Error("offline"));
    await expect(fetchClawDiscovery()).rejects.toThrow("offline");
  });
});
