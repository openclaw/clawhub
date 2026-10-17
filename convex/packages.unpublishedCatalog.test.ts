/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { listAuditPage } from "./packages";

const listAuditPageHandler = (
  listAuditPage as unknown as {
    _handler: (
      ctx: unknown,
      args: { paginationOpts: { cursor: null; numItems: number } },
    ) => Promise<{ page: Array<{ package: { displayName: string; name: string } }> }>;
  }
)._handler;

describe("packages.listAuditPage", () => {
  it("omits a package that has no published release", async () => {
    const pending = {
      _id: "packages:pending",
      family: "code-plugin",
      channel: "community",
      scanStatus: "pending",
      softDeletedAt: undefined,
      name: "@openclaw/pending-plugin",
      displayName: "Pending Plugin",
      summary: "Still scanning",
      icon: "https://pending.example/icon.png",
      ownerPublisherId: "publishers:org",
      ownerUserId: "users:owner",
      isOfficial: false,
      stats: { downloads: 0, installs: 0, stars: 0, versions: 0 },
      createdAt: 1,
      updatedAt: 1,
    };
    const published = {
      ...pending,
      _id: "packages:published",
      name: "@openclaw/published-plugin",
      displayName: "Published Plugin",
      summary: "A public plugin",
      scanStatus: "clean",
      latestReleaseId: "packageReleases:1",
      latestVersionSummary: { version: "1.0.0" },
      stats: { downloads: 4, installs: 2, stars: 1, versions: 1 },
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publishers:org") {
            return {
              _id: id,
              _creationTime: 1,
              kind: "org",
              handle: "openclaw",
              displayName: "OpenClaw",
            };
          }
          return null;
        }),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              paginate: vi.fn(async () => ({
                page: [pending, published],
                isDone: true,
                continueCursor: "",
              })),
            })),
          })),
        })),
      },
    };

    const result = await listAuditPageHandler(ctx, {
      paginationOpts: { cursor: null, numItems: 10 },
    });

    expect(result.page.map((item) => item.package.displayName)).toEqual(["Published Plugin"]);
  });
});
