import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackageDetailResponse } from "../../../lib/packageApi";

const mocks = vi.hoisted(() => ({
  fetchPackageDetail: vi.fn(),
  fetchPackageFile: vi.fn(),
}));

vi.mock("../../../lib/packageApi", () => mocks);

import { loadPublisherClaw } from "./$slug";

function packageDetail(family: "claw" | "code-plugin" = "claw"): PackageDetailResponse {
  return {
    package: {
      name: "@maker/release-brief",
      displayName: "Release Brief",
      family,
      channel: "community",
      isOfficial: false,
      summary: "Summarizes releases for a new user.",
      tags: [],
      ownerHandle: "maker",
      createdAt: 1,
      updatedAt: 2,
      latestVersion: "0.1.0",
      clawManifestSummary: {
        schemaVersion: 1,
        agent: { id: "release-brief", name: "Release Brief" },
        workspace: { bootstrapFiles: [], fileCount: 2 },
        packages: { skillCount: 1, pluginCount: 0 },
        mcpServerCount: 0,
        cronJobCount: 0,
      },
    },
    owner: { handle: "maker", displayName: "Maker", image: null },
  } as PackageDetailResponse;
}

describe("publisher Claw detail route loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchPackageFile.mockResolvedValue("# Release Brief");
  });

  it("loads only a public Claw owned by the requested publisher", async () => {
    mocks.fetchPackageDetail.mockResolvedValue(packageDetail());

    const loaded = await loadPublisherClaw({ owner: "maker", slug: "release-brief" });

    expect(loaded.detail.package?.family).toBe("claw");
    expect(loaded.contents).toBe("# Release Brief");
    expect(mocks.fetchPackageFile).toHaveBeenCalledWith("@maker/release-brief", "CLAW.md", "0.1.0");
  });

  it("normalizes an at-prefixed publisher route before checking package ownership", async () => {
    mocks.fetchPackageDetail.mockResolvedValue(packageDetail());

    const loaded = await loadPublisherClaw({ owner: "@Maker", slug: "release-brief" });

    expect(loaded.detail.package?.family).toBe("claw");
    expect(mocks.fetchPackageDetail).toHaveBeenCalledWith("@maker/release-brief");
  });

  it("does not expose a plugin at a Claw URL", async () => {
    mocks.fetchPackageDetail.mockResolvedValue(packageDetail("code-plugin"));

    await expect(
      loadPublisherClaw({ owner: "maker", slug: "release-brief" }),
    ).rejects.toMatchObject({ isNotFound: true });
    expect(mocks.fetchPackageFile).not.toHaveBeenCalled();
  });

  it("does not expose another publisher's package", async () => {
    mocks.fetchPackageDetail.mockResolvedValue({
      ...packageDetail(),
      owner: { handle: "someone-else" },
    });

    await expect(
      loadPublisherClaw({ owner: "maker", slug: "release-brief" }),
    ).rejects.toMatchObject({ isNotFound: true });
    expect(mocks.fetchPackageFile).not.toHaveBeenCalled();
  });
});
