/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

const retentionRefs = vi.hoisted(() => ({
  pruneExpiredAuthSessionsInternal: Symbol("pruneExpiredAuthSessionsInternal"),
  pruneExpiredAuthRefreshTokensInternal: Symbol("pruneExpiredAuthRefreshTokensInternal"),
  pruneExpiredPublisherInvitesInternal: Symbol("pruneExpiredPublisherInvitesInternal"),
}));

vi.mock("./_generated/api", () => ({
  internal: {
    retention: retentionRefs,
  },
}));

const {
  pruneExpiredAuthRefreshTokensInternal,
  pruneExpiredAuthSessionsInternal,
  pruneExpiredPublisherInvitesInternal,
} = await import("./retention");

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const pruneSessionsHandler = (
  pruneExpiredAuthSessionsInternal as unknown as WrappedHandler<
    { batchSize?: number },
    { deletedSessions: number; deletedRefreshTokens: number; hasMore: boolean }
  >
)._handler;
const pruneTokensHandler = (
  pruneExpiredAuthRefreshTokensInternal as unknown as WrappedHandler<
    { batchSize?: number },
    { deleted: number; hasMore: boolean }
  >
)._handler;
const prunePublisherInvitesHandler = (
  pruneExpiredPublisherInvitesInternal as unknown as WrappedHandler<
    { batchSize?: number },
    { deleted: number; hasMore: boolean }
  >
)._handler;

function makeDb(base: { query: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }) {
  return {
    ...base,
    get: vi.fn(),
    insert: vi.fn(),
    patch: vi.fn(),
    replace: vi.fn(),
    normalizeId: vi.fn(),
    system: {
      get: vi.fn(),
      query: vi.fn(),
    },
  };
}

describe("auth retention", () => {
  it("deletes expired sessions and their refresh tokens in bounded batches", async () => {
    const now = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const runAfter = vi.fn();
    const deleteDoc = vi.fn();
    const tokenRows = [{ _id: "authRefreshTokens:one" }, { _id: "authRefreshTokens:two" }];
    const sessionRows = [{ _id: "authSessions:expired", expirationTime: now - 1 }];
    const indexCalls: Array<{ table: string; indexName: string; field: string; value: number }> =
      [];

    const ctx = {
      db: makeDb({
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string, build: (q: unknown) => unknown) => {
            const q = {
              lt: vi.fn((field: string, value: number) => {
                indexCalls.push({ table, indexName, field, value });
                return q;
              }),
              eq: vi.fn(() => q),
            };
            build(q);
            return {
              take: vi.fn(async (limit?: number) =>
                table === "authSessions" ? sessionRows : tokenRows.slice(0, limit),
              ),
            };
          }),
        })),
        delete: deleteDoc,
      }),
      scheduler: { runAfter },
    };

    const result = await pruneSessionsHandler(ctx as never, {});

    expect(result).toEqual({
      deletedSessions: 1,
      deletedRefreshTokens: 2,
      hasMore: false,
    });
    expect(indexCalls).toContainEqual({
      table: "authSessions",
      indexName: "by_expiration_time",
      field: "expirationTime",
      value: now,
    });
    expect(deleteDoc).toHaveBeenCalledWith("authRefreshTokens:one");
    expect(deleteDoc).toHaveBeenCalledWith("authRefreshTokens:two");
    expect(deleteDoc).toHaveBeenCalledWith("authSessions:expired");
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("keeps an expired session until its refresh tokens are drained", async () => {
    const now = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const runAfter = vi.fn();
    const deleteDoc = vi.fn();
    const tokenRows = [{ _id: "authRefreshTokens:one" }];
    const sessionRows = [{ _id: "authSessions:expired", expirationTime: now - 1 }];

    const ctx = {
      db: makeDb({
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((_indexName: string, build: (q: unknown) => unknown) => {
            const q = {
              lt: vi.fn(() => q),
              eq: vi.fn(() => q),
            };
            build(q);
            return {
              take: vi.fn(async (limit?: number) =>
                table === "authSessions" ? sessionRows : tokenRows.slice(0, limit),
              ),
            };
          }),
        })),
        delete: deleteDoc,
      }),
      scheduler: { runAfter },
    };

    const result = await pruneSessionsHandler(ctx as never, { batchSize: 1 });

    expect(result).toEqual({
      deletedSessions: 0,
      deletedRefreshTokens: 1,
      hasMore: true,
    });
    expect(deleteDoc).toHaveBeenCalledWith("authRefreshTokens:one");
    expect(deleteDoc).not.toHaveBeenCalledWith("authSessions:expired");
    expect(runAfter).toHaveBeenCalledWith(0, retentionRefs.pruneExpiredAuthSessionsInternal, {
      batchSize: 1,
    });
  });

  it("deletes expired orphan refresh tokens by expiration time", async () => {
    const now = 2_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const deleteDoc = vi.fn();
    const rows = [{ _id: "authRefreshTokens:expired", expirationTime: now - 1 }];
    const lt = vi.fn(() => ({}));

    const ctx = {
      db: makeDb({
        query: vi.fn(() => ({
          withIndex: vi.fn((_indexName: string, build: (q: unknown) => unknown) => {
            build({ lt });
            return { take: vi.fn(async () => rows) };
          }),
        })),
        delete: deleteDoc,
      }),
      scheduler: { runAfter: vi.fn() },
    };

    const result = await pruneTokensHandler(ctx as never, {});

    expect(result).toEqual({ deleted: 1, hasMore: false });
    expect(lt).toHaveBeenCalledWith("expirationTime", now);
    expect(deleteDoc).toHaveBeenCalledWith("authRefreshTokens:expired");
  });

  it("deletes expired publisher invites by expiry time", async () => {
    const now = 3_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const deleteDoc = vi.fn();
    const rows = [{ _id: "publisherInvites:expired", expiresAt: now - 1 }];
    const lt = vi.fn(() => ({}));

    const ctx = {
      db: makeDb({
        query: vi.fn(() => ({
          withIndex: vi.fn((indexName: string, build: (q: unknown) => unknown) => {
            expect(indexName).toBe("by_expires_at");
            build({ lt });
            return { take: vi.fn(async () => rows) };
          }),
        })),
        delete: deleteDoc,
      }),
      scheduler: { runAfter: vi.fn() },
    };

    const result = await prunePublisherInvitesHandler(ctx as never, {});

    expect(result).toEqual({ deleted: 1, hasMore: false });
    expect(lt).toHaveBeenCalledWith("expiresAt", now);
    expect(deleteDoc).toHaveBeenCalledWith("publisherInvites:expired");
  });

  it("continues publisher invite retention when the batch is full", async () => {
    const runAfter = vi.fn();
    const rows = [{ _id: "publisherInvites:one" }];
    const deleteDoc = vi.fn();
    const ctx = {
      db: makeDb({
        query: vi.fn(() => ({
          withIndex: vi.fn((_indexName: string, build: (q: unknown) => unknown) => {
            build({ lt: vi.fn() });
            return { take: vi.fn(async () => rows) };
          }),
        })),
        delete: deleteDoc,
      }),
      scheduler: { runAfter },
    };

    const result = await prunePublisherInvitesHandler(ctx as never, { batchSize: 1 });

    expect(result).toEqual({ deleted: 1, hasMore: true });
    expect(runAfter).toHaveBeenCalledWith(0, retentionRefs.pruneExpiredPublisherInvitesInternal, {
      batchSize: 1,
    });
  });
});
