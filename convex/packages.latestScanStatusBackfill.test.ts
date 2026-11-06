/* @vitest-environment node */

import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { backfillLatestPackageScanStatus } from "./packages";

const auth = vi.hoisted(() => ({ requireUserFromAction: vi.fn() }));
vi.mock("./lib/access", async (original) => ({
  ...(await original<typeof import("./lib/access")>()),
  requireUserFromAction: auth.requireUserFromAction,
}));

type Handler = { _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown> };
const backfillLatest = (backfillLatestPackageScanStatus as unknown as Handler)._handler;

describe("packages.backfillLatestPackageScanStatus", () => {
  it("requires admin authorization before rewriting catalog scanStatus", async () => {
    const args = { batchSize: 25 };
    const ctx = {
      runMutation: vi.fn(async () => ({ patched: 0, isDone: true, scanned: 0 })),
    };
    auth.requireUserFromAction.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(backfillLatest(ctx, args)).rejects.toThrow("Unauthorized");
    for (const role of ["user", "moderator"]) {
      auth.requireUserFromAction.mockResolvedValueOnce({ user: { role } });
      await expect(backfillLatest(ctx, args)).rejects.toThrow("Forbidden");
    }
    expect(ctx.runMutation).not.toHaveBeenCalled();
    auth.requireUserFromAction.mockResolvedValueOnce({ user: { role: "admin" } });
    await expect(backfillLatest(ctx, args)).resolves.toMatchObject({ isDone: true });
    const [ref, delegated] = ctx.runMutation.mock.calls[0] as unknown as [
      Parameters<typeof getFunctionName>[0],
      unknown,
    ];
    expect(getFunctionName(ref)).toBe("packages:backfillLatestPackageScanStatusInternal");
    expect(delegated).toEqual(args);
  });
});
