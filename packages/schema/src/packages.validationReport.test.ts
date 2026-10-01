import { describe, expect, it } from "vitest";
import { parseArk } from "./ark.js";
import { ApiV1PackageValidationReportPageSchema } from "./packages.js";

describe("ApiV1PackageValidationReportPageSchema", () => {
  it("accepts a paginated plugin validation report page", () => {
    const page = {
      items: [
        {
          package: { id: "packages:demo", name: "@openclaw/demo", displayName: "Demo" },
          release: { id: "packageReleases:demo", version: "1.2.3", createdAt: 100 },
          references: {
            packagePage: "/plugins/%40openclaw%2Fdemo",
            release: "@openclaw/demo@1.2.3",
          },
          scan: {
            status: "error",
            scannedAt: 200,
            target: { channel: "beta", version: "2026.7.30-beta.1" },
            inspectorVersion: "0.3.19",
            skipReason: null,
          },
          findings: [
            { severity: "error", code: "missing-api", message: "Required API is unavailable" },
          ],
        },
      ],
      nextCursor: "page-2",
      done: false,
    };

    expect(parseArk(ApiV1PackageValidationReportPageSchema, page, "validation report")).toEqual(
      page,
    );
  });

  it("rejects unknown scan statuses", () => {
    expect(() =>
      parseArk(
        ApiV1PackageValidationReportPageSchema,
        {
          items: [
            {
              package: { id: "packages:demo", name: "demo", displayName: "Demo" },
              release: { id: "packageReleases:demo", version: "1.0.0", createdAt: 100 },
              references: { packagePage: "/plugins/demo", release: "demo@1.0.0" },
              scan: {
                status: "stale",
                scannedAt: null,
                target: null,
                inspectorVersion: null,
                skipReason: null,
              },
              findings: [],
            },
          ],
          nextCursor: null,
          done: true,
        },
        "validation report",
      ),
    ).toThrow(/status/);
  });
});
