import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/access", () => ({
  requireUser: vi.fn(),
}));

const { requireUser } = await import("./lib/access");
const { approve, deny } = await import("./cliDeviceAuth");

const approveHandler = (approve as unknown as { _handler: Function })._handler;
const denyHandler = (deny as unknown as { _handler: Function })._handler;

function makeCtx(rows: Array<Record<string, unknown>>) {
  const take = vi.fn().mockResolvedValue(rows);
  const order = vi.fn().mockReturnValue({ take });
  const withIndex = vi.fn().mockReturnValue({ order });
  const query = vi.fn().mockReturnValue({ withIndex });
  const get = vi.fn().mockResolvedValue(null);
  const insert = vi.fn().mockResolvedValue("inserted:id");
  const patch = vi.fn().mockResolvedValue(undefined);
  const replace = vi.fn().mockResolvedValue(undefined);
  const delete_ = vi.fn().mockResolvedValue(undefined);
  const normalizeId = vi.fn().mockReturnValue(null);

  return {
    ctx: { db: { get, insert, query, patch, replace, delete: delete_, normalizeId } },
    order,
    take,
    withIndex,
    query,
    patch,
  };
}

describe("cliDeviceAuth approval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:approver",
      user: { _id: "users:approver" },
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(requireUser).mockReset();
  });

  it("approves the newest active pending row when duplicate user codes exist", async () => {
    const now = Date.now();
    const { ctx, order, patch, take } = makeCtx([
      {
        _id: "cliDeviceCodes:new",
        _creationTime: now - 1_000,
        status: "pending",
        userCode: "Q639-NBSX",
        createdAt: now - 1_000,
        expiresAt: now + 60_000,
      },
      {
        _id: "cliDeviceCodes:old",
        _creationTime: now - 10_000,
        status: "pending",
        userCode: "Q639-NBSX",
        createdAt: now - 10_000,
        expiresAt: now + 60_000,
      },
    ]);

    const result = await approveHandler(ctx, { userCode: "q639-nbsx" });

    expect(result).toEqual({
      ok: true,
      userCode: "Q639-NBSX",
      expiresAt: now + 60_000,
    });
    expect(order).toHaveBeenCalledWith("desc");
    expect(take).toHaveBeenCalledWith(50);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("cliDeviceCodes:new", {
      status: "approved",
      approvedByUserId: "users:approver",
      approvedAt: now,
    });
  });

  it("uses descending index order when duplicate creation timestamps disagree", async () => {
    const now = Date.now();
    const { ctx, patch } = makeCtx([
      {
        _id: "cliDeviceCodes:new",
        _creationTime: now - 1_000,
        status: "pending",
        userCode: "Q639-NBSX",
        createdAt: now - 20_000,
        expiresAt: now + 60_000,
      },
      {
        _id: "cliDeviceCodes:old",
        _creationTime: now - 10_000,
        status: "pending",
        userCode: "Q639-NBSX",
        createdAt: now - 500,
        expiresAt: now + 60_000,
      },
    ]);

    await approveHandler(ctx, { userCode: "Q639-NBSX" });

    expect(patch).toHaveBeenCalledWith("cliDeviceCodes:new", {
      status: "approved",
      approvedByUserId: "users:approver",
      approvedAt: now,
    });
  });

  it("expires stale pending rows before approving an active row", async () => {
    const now = Date.now();
    const { ctx, patch } = makeCtx([
      {
        _id: "cliDeviceCodes:expired",
        _creationTime: now - 100_000,
        status: "pending",
        userCode: "Q639-NBSX",
        createdAt: now - 100_000,
        expiresAt: now - 1,
      },
      {
        _id: "cliDeviceCodes:active",
        _creationTime: now - 1_000,
        status: "pending",
        userCode: "Q639-NBSX",
        createdAt: now - 1_000,
        expiresAt: now + 60_000,
      },
    ]);

    await approveHandler(ctx, { userCode: "Q639-NBSX" });

    expect(patch).toHaveBeenNthCalledWith(1, "cliDeviceCodes:expired", { status: "expired" });
    expect(patch).toHaveBeenNthCalledWith(2, "cliDeviceCodes:active", {
      status: "approved",
      approvedByUserId: "users:approver",
      approvedAt: now,
    });
  });

  it("preserves stale terminal rows while expiring stale pending duplicates", async () => {
    const now = Date.now();
    const { ctx, patch } = makeCtx([
      {
        _id: "cliDeviceCodes:approved",
        _creationTime: now - 100_000,
        status: "approved",
        userCode: "Q639-NBSX",
        createdAt: now - 100_000,
        expiresAt: now - 1,
        approvedAt: now - 90_000,
        approvedByUserId: "users:previous",
      },
      {
        _id: "cliDeviceCodes:denied",
        _creationTime: now - 90_000,
        status: "denied",
        userCode: "Q639-NBSX",
        createdAt: now - 90_000,
        expiresAt: now - 1,
        deniedAt: now - 80_000,
      },
      {
        _id: "cliDeviceCodes:consumed",
        _creationTime: now - 80_000,
        status: "consumed",
        userCode: "Q639-NBSX",
        createdAt: now - 80_000,
        expiresAt: now - 1,
        consumedAt: now - 70_000,
      },
      {
        _id: "cliDeviceCodes:expired",
        _creationTime: now - 70_000,
        status: "pending",
        userCode: "Q639-NBSX",
        createdAt: now - 70_000,
        expiresAt: now - 1,
      },
      {
        _id: "cliDeviceCodes:active",
        _creationTime: now - 1_000,
        status: "pending",
        userCode: "Q639-NBSX",
        createdAt: now - 1_000,
        expiresAt: now + 60_000,
      },
    ]);

    await approveHandler(ctx, { userCode: "Q639-NBSX" });

    expect(patch).toHaveBeenNthCalledWith(1, "cliDeviceCodes:expired", { status: "expired" });
    expect(patch).toHaveBeenNthCalledWith(2, "cliDeviceCodes:active", {
      status: "approved",
      approvedByUserId: "users:approver",
      approvedAt: now,
    });
    expect(patch).not.toHaveBeenCalledWith("cliDeviceCodes:approved", expect.anything());
    expect(patch).not.toHaveBeenCalledWith("cliDeviceCodes:denied", expect.anything());
    expect(patch).not.toHaveBeenCalledWith("cliDeviceCodes:consumed", expect.anything());
  });

  it.each([
    ["expired", "Device code expired"],
    ["consumed", "Device code already used"],
    ["approved", "Device code already authorized"],
    ["denied", "Device code was denied"],
  ])("surfaces %s codes as user-facing errors", async (status, message) => {
    const now = Date.now();
    const { ctx } = makeCtx([
      {
        _id: `cliDeviceCodes:${status}`,
        _creationTime: now - 1_000,
        status,
        userCode: "Q639-NBSX",
        createdAt: now - 1_000,
        expiresAt: now + 60_000,
      },
    ]);

    let caught: unknown;
    try {
      await approveHandler(ctx, { userCode: "Q639-NBSX" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConvexError);
    expect((caught as ConvexError<string>).data).toBe(message);
  });

  it("denies the newest active pending row when duplicate user codes exist", async () => {
    const now = Date.now();
    const { ctx, patch } = makeCtx([
      {
        _id: "cliDeviceCodes:new",
        _creationTime: now - 1_000,
        status: "pending",
        userCode: "Q639-NBSX",
        createdAt: now - 1_000,
        expiresAt: now + 60_000,
      },
      {
        _id: "cliDeviceCodes:old",
        _creationTime: now - 10_000,
        status: "pending",
        userCode: "Q639-NBSX",
        createdAt: now - 10_000,
        expiresAt: now + 60_000,
      },
    ]);

    await expect(denyHandler(ctx, { userCode: "Q639-NBSX" })).resolves.toEqual({ ok: true });

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("cliDeviceCodes:new", {
      status: "denied",
      deniedAt: now,
    });
  });

  it("does not deny stale pending rows after expiring them", async () => {
    const now = Date.now();
    const { ctx, patch } = makeCtx([
      {
        _id: "cliDeviceCodes:expired",
        _creationTime: now - 100_000,
        status: "pending",
        userCode: "Q639-NBSX",
        createdAt: now - 100_000,
        expiresAt: now - 1,
      },
    ]);

    await expect(denyHandler(ctx, { userCode: "Q639-NBSX" })).resolves.toEqual({ ok: true });

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("cliDeviceCodes:expired", { status: "expired" });
    expect(patch).not.toHaveBeenCalledWith("cliDeviceCodes:expired", {
      status: "denied",
      deniedAt: now,
    });
  });
});
