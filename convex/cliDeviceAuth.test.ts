import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/access", () => ({
  requireUser: vi.fn(),
}));

const { requireUser } = await import("./lib/access");
const { approve, deny } = await import("./cliDeviceAuth");

const approveHandler = (approve as unknown as { _handler: Function })._handler;
const denyHandler = (deny as unknown as { _handler: Function })._handler;

function makeCtx(rows: Array<Record<string, unknown>>) {
  const collect = vi.fn().mockResolvedValue(rows);
  const withIndex = vi.fn().mockReturnValue({ collect });
  const query = vi.fn().mockReturnValue({ withIndex });
  const get = vi.fn().mockResolvedValue(null);
  const insert = vi.fn().mockResolvedValue("inserted:id");
  const patch = vi.fn().mockResolvedValue(undefined);
  const replace = vi.fn().mockResolvedValue(undefined);
  const delete_ = vi.fn().mockResolvedValue(undefined);
  const normalizeId = vi.fn().mockReturnValue(null);

  return {
    ctx: { db: { get, insert, query, patch, replace, delete: delete_, normalizeId } },
    collect,
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
    const { ctx, patch } = makeCtx([
      {
        _id: "cliDeviceCodes:old",
        _creationTime: now - 10_000,
        status: "pending",
        userCode: "Q639-NBSX",
        createdAt: now - 10_000,
        expiresAt: now + 60_000,
      },
      {
        _id: "cliDeviceCodes:new",
        _creationTime: now - 1_000,
        status: "pending",
        userCode: "Q639-NBSX",
        createdAt: now - 1_000,
        expiresAt: now + 60_000,
      },
    ]);

    const result = await approveHandler(ctx, { userCode: "q639-nbsx" });

    expect(result).toEqual({
      ok: true,
      userCode: "Q639-NBSX",
      expiresAt: now + 60_000,
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("cliDeviceCodes:new", {
      status: "approved",
      approvedByUserId: "users:approver",
      approvedAt: now,
    });
  });

  it("expires stale duplicate rows before approving an active row", async () => {
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

  it("denies the newest active pending row when duplicate user codes exist", async () => {
    const now = Date.now();
    const { ctx, patch } = makeCtx([
      {
        _id: "cliDeviceCodes:old",
        _creationTime: now - 10_000,
        status: "pending",
        userCode: "Q639-NBSX",
        createdAt: now - 10_000,
        expiresAt: now + 60_000,
      },
      {
        _id: "cliDeviceCodes:new",
        _creationTime: now - 1_000,
        status: "pending",
        userCode: "Q639-NBSX",
        createdAt: now - 1_000,
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
});
