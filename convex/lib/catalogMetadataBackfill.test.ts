import { describe, expect, it } from "vitest";
import {
  buildPackageCatalogMetadataBackfillPatch,
  buildSkillCatalogMetadataBackfillPatch,
} from "./catalogMetadataBackfill";

describe("catalog metadata backfill", () => {
  it("stores inferred skill categories without overwriting valid corrections", () => {
    expect(
      buildSkillCatalogMetadataBackfillPatch({
        slug: "browser-research",
        displayName: "Browser Research",
        summary: "Search and browse the web",
        primaryCategory: undefined,
        capabilityTags: undefined,
        topics: undefined,
      } as never),
    ).toEqual({ primaryCategory: "web-research" });

    expect(
      buildSkillCatalogMetadataBackfillPatch({
        slug: "browser-research",
        displayName: "Browser Research",
        summary: "Search and browse the web",
        primaryCategory: "security-review",
        capabilityTags: undefined,
        topics: undefined,
      } as never),
    ).toEqual({});
  });

  it("stores provider plugins separately from MCP tooling and normalizes existing topics", () => {
    expect(
      buildPackageCatalogMetadataBackfillPatch({
        family: "code-plugin",
        name: "@openclaw/anthropic",
        displayName: "Anthropic Provider",
        summary: "Text inference provider",
        runtimeId: "anthropic",
        capabilityTags: ["capability:model-provider"],
        primaryCategory: undefined,
        topics: [" Local Models ", "local-models"],
      } as never),
    ).toEqual({
      primaryCategory: "model-providers",
      topics: ["local-models"],
    });
  });

  it("stores unmatched catalog entries as internal uncategorized", () => {
    expect(
      buildSkillCatalogMetadataBackfillPatch({
        slug: "misc",
        displayName: "Misc",
        summary: "A focused helper",
        primaryCategory: undefined,
        capabilityTags: undefined,
        topics: undefined,
      } as never),
    ).toEqual({ primaryCategory: "uncategorized" });
  });
});
