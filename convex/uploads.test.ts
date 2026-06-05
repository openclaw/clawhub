/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { consumePackagePublishUploadTicketInternal } from "./uploads";

type ConsumeArgs = {
  uploadTicket: string;
  storageId: string;
  auth: { kind: "user"; userId: string } | { kind: "github-actions"; publishTokenId: string };
};

type WrappedHandler<TArgs> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<void>;
};

const consumeHandler = (
  consumePackagePublishUploadTicketInternal as unknown as WrappedHandler<ConsumeArgs>
)._handler;

function makeCtx(ticket: Record<string, unknown> | null, storage: Record<string, unknown> | null) {
  return {
    db: {
      get: vi.fn(async () => ticket),
      insert: vi.fn(),
      normalizeId: vi.fn(),
      patch: vi.fn(),
      query: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      system: {
        get: vi.fn(async () => storage),
        query: vi.fn(),
      },
    },
  };
}

describe("package publish upload tickets", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("consumes a fresh upload ticket for the same user", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const ctx = makeCtx(
      {
        _id: "packagePublishUploadTickets:1",
        kind: "user",
        userId: "users:1",
        createdAt: 1_000,
        expiresAt: 10_000,
      },
      { _id: "storage:1", _creationTime: 1_500 },
    );

    await consumeHandler(ctx, {
      uploadTicket: "packagePublishUploadTickets:1",
      storageId: "storage:1",
      auth: { kind: "user", userId: "users:1" },
    });

    expect(ctx.db.system.get).toHaveBeenCalledWith("_storage", "storage:1");
    expect(ctx.db.patch).toHaveBeenCalledWith("packagePublishUploadTickets:1", {
      usedAt: 2_000,
      storageId: "storage:1",
    });
  });

  it("allows retrying a used upload ticket for the same user and storage id", async () => {
    vi.spyOn(Date, "now").mockReturnValue(3_000);
    const ctx = makeCtx(
      {
        _id: "packagePublishUploadTickets:1",
        kind: "user",
        userId: "users:1",
        createdAt: 1_000,
        expiresAt: 10_000,
        usedAt: 2_000,
        storageId: "storage:1",
      },
      { _id: "storage:1", _creationTime: 1_500 },
    );

    await consumeHandler(ctx, {
      uploadTicket: "packagePublishUploadTickets:1",
      storageId: "storage:1",
      auth: { kind: "user", userId: "users:1" },
    });

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("rejects upload tickets from another auth context", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const ctx = makeCtx(
      {
        _id: "packagePublishUploadTickets:1",
        kind: "user",
        userId: "users:1",
        createdAt: 1_000,
        expiresAt: 10_000,
      },
      { _id: "storage:1", _creationTime: 1_500 },
    );

    await expect(
      consumeHandler(ctx, {
        uploadTicket: "packagePublishUploadTickets:1",
        storageId: "storage:1",
        auth: { kind: "user", userId: "users:2" },
      }),
    ).rejects.toThrow("Package tarball upload ticket does not match this publish token");

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("rejects storage created before the upload ticket", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const ctx = makeCtx(
      {
        _id: "packagePublishUploadTickets:1",
        kind: "github-actions",
        publishTokenId: "packagePublishTokens:1",
        createdAt: 1_000,
        expiresAt: 10_000,
      },
      { _id: "storage:1", _creationTime: 999 },
    );

    await expect(
      consumeHandler(ctx, {
        uploadTicket: "packagePublishUploadTickets:1",
        storageId: "storage:1",
        auth: { kind: "github-actions", publishTokenId: "packagePublishTokens:1" },
      }),
    ).rejects.toThrow("Package tarball upload must be created after its upload ticket");

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});
