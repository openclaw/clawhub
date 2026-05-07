/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { moderationDecisionRowsFromConvexExportTables } from "./export-moderation-decisions";

describe("moderation decision export", () => {
  it("skips decisions for package releases excluded from artifact export", () => {
    const rows = moderationDecisionRowsFromConvexExportTables({
      skills: [],
      skillVersions: [],
      packages: [
        {
          _id: "packages:private",
          displayName: "Private Package",
          name: "@demo/private",
          channel: "private",
          family: "code-plugin",
        },
      ],
      packageReleases: [
        {
          _id: "packageReleases:private",
          packageId: "packages:private",
          version: "1.0.0",
          createdAt: 1,
          files: [],
        },
      ],
      skillReports: [],
      skillAppeals: [],
      packageReports: [
        {
          _id: "packageReports:private",
          packageId: "packages:private",
          releaseId: "packageReleases:private",
          status: "dismissed",
          triageNote: "not exported",
          triagedAt: 2,
          triagedBy: "users:moderator",
          reviewVerdict: "clean",
          createdAt: 1,
        },
      ],
      packageAppeals: [],
    });

    expect(rows).toEqual([]);
  });

  it("skips package-level decisions without an exported artifact", () => {
    const rows = moderationDecisionRowsFromConvexExportTables({
      skills: [],
      skillVersions: [],
      packages: [
        {
          _id: "packages:private",
          displayName: "Private Package",
          name: "@demo/private",
          channel: "private",
          family: "code-plugin",
        },
      ],
      packageReleases: [],
      skillReports: [],
      skillAppeals: [],
      packageReports: [
        {
          _id: "packageReports:private",
          packageId: "packages:private",
          status: "dismissed",
          triageNote: "not exported",
          triagedAt: 2,
          triagedBy: "users:moderator",
          reviewVerdict: "clean",
          createdAt: 1,
        },
      ],
      packageAppeals: [],
    });

    expect(rows).toEqual([]);
  });
});
