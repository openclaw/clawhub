/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { runCatalogTaxonomyPrerequisites } from "./migrations";

type WrappedHandler = {
  _handler: (ctx: unknown, args: { dryRun?: boolean }) => Promise<unknown>;
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
});
