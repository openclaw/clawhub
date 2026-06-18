/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { runCatalogClassificationApply, runCatalogTaxonomyPrerequisites } from "./migrations";

type WrappedHandler = {
  _handler: (ctx: unknown, args: { dryRun?: boolean }) => Promise<unknown>;
};

type ClassificationApplyWrappedHandler = {
  _handler: (
    ctx: unknown,
    args: { dryRun?: boolean; minimumConfidence: "high" | "medium"; confirm?: string },
  ) => Promise<unknown>;
};

describe("catalog taxonomy migrations", () => {
  it("dry-runs both tracked digest migrations", async () => {
    const runMutation = vi.fn().mockResolvedValue({});
    const handler = (runCatalogTaxonomyPrerequisites as unknown as WrappedHandler)._handler;

    await handler({ runMutation }, { dryRun: true });

    expect(runMutation).toHaveBeenNthCalledWith(1, internal.migrations.run, {
      fn: "migrations:rebuildCatalogTaxonomyPackageDigests",
      dryRun: true,
      reset: true,
    });
    expect(runMutation).toHaveBeenNthCalledWith(2, internal.migrations.run, {
      fn: "migrations:rebuildCatalogTaxonomySkillDigests",
      dryRun: true,
      reset: true,
    });
  });

  it("dry-runs the selected classification apply migration", async () => {
    const runMutation = vi.fn().mockResolvedValue({});
    const handler = (runCatalogClassificationApply as unknown as ClassificationApplyWrappedHandler)
      ._handler;

    await handler({ runMutation }, { minimumConfidence: "medium" });

    expect(runMutation).toHaveBeenCalledWith(internal.migrations.run, {
      fn: "migrations:applyMediumConfidenceCatalogClassifications",
      dryRun: true,
      reset: true,
    });
  });

  it("requires an explicit confidence-specific confirmation before applying", async () => {
    const handler = (runCatalogClassificationApply as unknown as ClassificationApplyWrappedHandler)
      ._handler;

    await expect(
      handler({ runMutation: vi.fn() }, { dryRun: false, minimumConfidence: "high" }),
    ).rejects.toThrow('Pass confirm="apply-high-confidence-catalog-classifications" to apply.');
  });
});
