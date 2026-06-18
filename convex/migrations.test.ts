/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { runSkillInstallBackfill } from "./migrations";

type InstallBackfillWrappedHandler = {
  _handler: (ctx: unknown, args: { dryRun?: boolean; confirm?: string }) => Promise<unknown>;
};

describe("skill install backfill migration", () => {
  it("dry-runs the install backfill migration through the tracked runner", async () => {
    const runMutation = vi.fn().mockResolvedValue({});
    const handler = (runSkillInstallBackfill as unknown as InstallBackfillWrappedHandler)._handler;

    const result = await handler({ runMutation }, {});

    expect(runMutation).toHaveBeenCalledWith(internal.migrations.run, {
      fn: "migrations:backfillSkillInstallEstimates",
      dryRun: true,
      reset: true,
    });
    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      confirmRequired: "apply-skill-install-backfill",
    });
  });

  it("requires an explicit confirmation before applying the install backfill", async () => {
    const handler = (runSkillInstallBackfill as unknown as InstallBackfillWrappedHandler)._handler;

    await expect(handler({ runMutation: vi.fn() }, { dryRun: false })).rejects.toThrow(
      'Pass confirm="apply-skill-install-backfill" to apply.',
    );
  });
});
