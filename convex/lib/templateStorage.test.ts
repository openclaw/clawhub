import { describe, expect, it } from "vitest";
import schema from "../schema";
import {
  toPublicPackageFamily,
  toStoredPackageFamily,
  withStoredPackageFamily,
} from "./templateStorage";

describe("stable physical Template storage boundary", () => {
  it("keeps the deployed package/digest and feed schema keys instead of requiring a production backfill", () => {
    const exported: {
      tables: Array<{ tableName: string; documentType: { value: Record<string, unknown> } }>;
    } = JSON.parse(schema.export());
    const fields = (name: string) =>
      exported.tables.find((table) => table.tableName === name)!.documentType.value;
    const family = {
      fieldType: {
        type: "union",
        value: ["skill", "code-plugin", "bundle-plugin", "claw"].map((value) => ({
          type: "literal",
          value,
        })),
      },
      optional: false,
    };
    for (const table of [
      "packages",
      "packageSearchDigest",
      "packageTopicSearchDigest",
      "packagePluginCategorySearchDigest",
    ])
      expect(fields(table).family).toEqual(family);
    expect(fields("packages")).toHaveProperty("clawProfilePolicyVersion");
    expect(fields("packages")).not.toHaveProperty("templateProfilePolicyVersion");
    expect(fields("packageReleases")).toHaveProperty("clawManifestSummary");
    expect(fields("packageReleases")).not.toHaveProperty("templateManifestSummary");
    for (const key of ["clawPolicyVersion", "clawEntryCount", "clawPublisherId"])
      expect(fields("catalogFeedPublications")).toHaveProperty(key);
    for (const key of ["templatePolicyVersion", "templateEntryCount", "templatePublisherId"])
      expect(fields("catalogFeedPublications")).not.toHaveProperty(key);
  });

  it("uses one historical index value while exposing only the canonical public family", () => {
    expect(toStoredPackageFamily("template")).toBe("claw");
    expect(toPublicPackageFamily("claw")).toBe("template");
    expect(toPublicPackageFamily("template")).toBe("template");
  });
  it.each(["skill", "code-plugin", "bundle-plugin"] as const)(
    "does not change ordinary %s records or filters",
    (family) => {
      expect(toStoredPackageFamily(family)).toBe(family);
      expect(toPublicPackageFamily(family)).toBe(family);
      const input = { family, category: "research", channel: "community" };
      expect(withStoredPackageFamily(input)).toEqual(input);
    },
  );
  it("translates only the physical family filter without mutating caller arguments", () => {
    const input = { family: "template" as const, category: "research", limit: 37 };
    expect(withStoredPackageFamily(input)).toEqual({ ...input, family: "claw" });
    expect(input.family).toBe("template");
  });
});
