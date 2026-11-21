/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import {
  extractPackageDigestFields,
  extractPackageFacetFields,
} from "./packageSearchDigestProjection";

function template(): Doc<"packages"> {
  return {
    _id: "packages:template" as Id<"packages">,
    _creationTime: 1,
    name: "@fixture/template",
    normalizedName: "@fixture/template",
    displayName: "Template",
    ownerUserId: "users:owner" as Id<"users">,
    family: "claw",
    channel: "community",
    isOfficial: false,
    tags: {},
    categories: ["travel"],
    topics: ["calendar"],
    stats: { downloads: 0, installs: 1, stars: 2, versions: 1 },
    createdAt: 1,
    updatedAt: 2,
  };
}

describe("package digest projections", () => {
  it("preserves shared references and present undefined fields without changing the package", () => {
    const pkg = template();
    const before = structuredClone(pkg);
    const fields = extractPackageDigestFields(pkg);

    expect(fields.categories).toBe(pkg.categories);
    expect(fields.stats).toBe(pkg.stats);
    expect(Object.hasOwn(fields, "summary")).toBe(true);
    expect(fields.summary).toBeUndefined();
    expect(Object.hasOwn(fields, "latestVersion")).toBe(true);
    expect(fields.latestVersion).toBeUndefined();
    expect(pkg).toEqual(before);
  });

  it("projects facet fields without copying nested values or leaking unrelated fields", () => {
    const fields = Object.assign(extractPackageDigestFields(template()), { unrelated: "private" });
    const facet = extractPackageFacetFields(fields);

    expect(facet).not.toBe(fields);
    expect(facet).not.toHaveProperty("unrelated");
    expect(facet.categories).toBe(fields.categories);
    expect(facet.topics).toBe(fields.topics);
    expect(facet.pluginCategoryTags).toBe(fields.pluginCategoryTags);
    expect(facet.stats).toBe(fields.stats);
    expect(Object.hasOwn(facet, "ownerHandle")).toBe(true);
    expect(facet.ownerHandle).toBeUndefined();
  });
});
