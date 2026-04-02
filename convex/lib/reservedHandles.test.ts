import { describe, expect, it, vi } from "vitest";
import {
  isHandleReservedForAnotherUser,
  normalizeReservedHandle,
  upsertReservedHandleForRightfulOwner,
} from "./reservedHandles";

describe("reservedHandles", () => {
  it("normalizes handles as lowercase keys", () => {
    expect(normalizeReservedHandle(" OpenClaw ")).toBe("openclaw");
    expect(normalizeReservedHandle("   ")).toBeUndefined();
  });

  it("detects reservations owned by another user", async () => {
    const db = {
      query: vi.fn((table: string) => {
        if (table !== "reservedHandles") throw new Error(`unexpected table ${table}`);
        return {
          withIndex: (name: string) => {
            if (name !== "by_handle_active_updatedAt") {
              throw new Error(`unexpected index ${name}`);
            }
            return {
              order: () => ({
                take: async () => [
                  {
                    _id: "reservedHandles:1",
                    handle: "openclaw",
                    rightfulOwnerUserId: "users:owner",
                    releasedAt: undefined,
                    createdAt: 1,
                    updatedAt: 2,
                  },
                ],
              }),
            };
          },
        };
      }),
    };

    await expect(
      isHandleReservedForAnotherUser({ db } as never, "OpenClaw", "users:other" as never),
    ).resolves.toBe(true);
  });

  it("upserts the latest active reservation", async () => {
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "reservedHandles:2");
    const db = {
      query: vi.fn(() => ({
        withIndex: () => ({
          order: () => ({
            take: async () => [
              {
                _id: "reservedHandles:1",
                handle: "openclaw",
                rightfulOwnerUserId: "users:old",
                reason: "old",
                releasedAt: undefined,
                createdAt: 1,
                updatedAt: 2,
              },
            ],
          }),
        }),
      })),
      patch,
      insert,
    };

    const id = await upsertReservedHandleForRightfulOwner({ db } as never, {
      handle: "OpenClaw",
      rightfulOwnerUserId: "users:new" as never,
      reason: "official org",
      now: 10,
    });

    expect(id).toBe("reservedHandles:1");
    expect(patch).toHaveBeenCalledWith("reservedHandles:1", {
      rightfulOwnerUserId: "users:new",
      reason: "official org",
      releasedAt: undefined,
      updatedAt: 10,
    });
    expect(insert).not.toHaveBeenCalled();
  });
});
