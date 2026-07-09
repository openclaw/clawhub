import { describe, expect, it } from "vitest";
import { PREVIEW_SEED_ROWS } from "./previewSeed";

describe("preview seed fixture", () => {
  it("contains a small deterministic mix of public skills and plugins", () => {
    expect(PREVIEW_SEED_ROWS).toHaveLength(4);
    expect(PREVIEW_SEED_ROWS.map((row) => row.kind)).toEqual([
      "skill",
      "skill",
      "plugin",
      "plugin",
    ]);
    expect(PREVIEW_SEED_ROWS.map((row) => (row.kind === "skill" ? row.slug : row.name))).toEqual([
      "preview-search-assistant",
      "preview-release-notes",
      "@preview/discord-channel",
      "@preview/automation-bundle",
    ]);
    expect(PREVIEW_SEED_ROWS.every((row) => typeof row.createdAt === "number")).toBe(true);
  });
});
