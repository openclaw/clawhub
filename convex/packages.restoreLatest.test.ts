import { describe, expect, it } from "vitest";
import {
  getPreferredRestoredPackageRelease,
  rebuildPackageTagsFromActiveReleases,
} from "./packages";

function makeRelease(overrides: Record<string, unknown> = {}) {
  return {
    _id: "packageReleases:published",
    version: "1.0.0",
    createdAt: 10,
    softDeletedAt: undefined,
    ownerDeletedAt: undefined,
    publicationStatus: "published",
    ...overrides,
  };
}

describe("getPreferredRestoredPackageRelease", () => {
  it("does not promote an unpublished sibling after the published latest is gone", () => {
    const next = getPreferredRestoredPackageRelease("code-plugin", [
      makeRelease({
        _id: "packageReleases:pending",
        version: "2.0.0",
        createdAt: 20,
        publicationStatus: "pending",
      }) as never,
      makeRelease({
        _id: "packageReleases:published",
        version: "1.0.0",
        createdAt: 10,
        publicationStatus: "published",
        softDeletedAt: 99,
      }) as never,
    ]);

    expect(next).toBeNull();
  });

  it("keeps the highest published remaining release", () => {
    const next = getPreferredRestoredPackageRelease("code-plugin", [
      makeRelease({
        _id: "packageReleases:pending",
        version: "2.0.0",
        createdAt: 20,
        publicationStatus: "pending",
      }) as never,
      makeRelease({
        _id: "packageReleases:older",
        version: "1.0.0",
        createdAt: 10,
        publicationStatus: "published",
      }) as never,
    ]);

    expect(next?._id).toBe("packageReleases:older");
  });
});

describe("rebuildPackageTagsFromActiveReleases", () => {
  it("does not copy unpublished latest onto rebuilt package tags", () => {
    const published = makeRelease({
      _id: "packageReleases:published",
      version: "1.0.0",
      createdAt: 10,
      publicationStatus: "published",
    });
    const pending = makeRelease({
      _id: "packageReleases:pending",
      version: "2.0.0",
      createdAt: 20,
      publicationStatus: "pending",
      distTags: ["latest"],
    });
    const activeReleases = [published, pending] as never[];

    const nextLatest = getPreferredRestoredPackageRelease("code-plugin", activeReleases);
    const nextTags = rebuildPackageTagsFromActiveReleases(activeReleases as never);

    expect(nextLatest?._id).toBe("packageReleases:published");
    expect(nextTags.latest).not.toBe("packageReleases:pending");
    expect(nextTags.latest).toBeUndefined();
  });

  it("drops tags.latest when only a pending row carries the latest distTag", () => {
    const pending = makeRelease({
      _id: "packageReleases:pending",
      version: "2.0.0",
      createdAt: 20,
      publicationStatus: "pending",
      distTags: ["latest"],
    });
    const activeReleases = [pending] as never[];

    const nextLatest = getPreferredRestoredPackageRelease("code-plugin", activeReleases);
    const nextTags = rebuildPackageTagsFromActiveReleases(activeReleases as never);

    expect(nextLatest).toBeNull();
    expect(nextTags.latest).toBeUndefined();
  });
});
