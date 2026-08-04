/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupSkillPublishUploadInternal,
  consumeSkillPublishUploads,
} from "./skillPublishUploads";

type CleanupHandler = {
  _handler: (
    ctx: unknown,
    args: { uploadTicket: "skillPublishUploadTickets:1" },
  ) => Promise<unknown>;
};

const cleanupHandler = (cleanupSkillPublishUploadInternal as unknown as CleanupHandler)._handler;

function makeCtx(ticket: Record<string, unknown> | null) {
  return {
    db: {
      get: vi.fn(async () => ticket),
      patch: vi.fn(),
      delete: vi.fn(),
      normalizeId: vi.fn(),
      query: vi.fn(),
      replace: vi.fn(),
      insert: vi.fn(),
      system: { get: vi.fn(), query: vi.fn() },
    },
    storage: { delete: vi.fn() },
  };
}

describe("skill publish upload tickets", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("atomically consumes a matching staged upload", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const ctx = makeCtx({
      _id: "skillPublishUploadTickets:1",
      userId: "users:1",
      path: "SKILL.md",
      size: 5,
      sha256: "a".repeat(64),
      contentType: "text/markdown",
      storageId: "storage:1",
      expiresAt: 10_000,
    });

    await consumeSkillPublishUploads(ctx as never, {
      userId: "users:1" as never,
      uploadTickets: ["skillPublishUploadTickets:1" as never],
      files: [
        {
          path: "SKILL.md",
          size: 5,
          sha256: "a".repeat(64),
          contentType: "text/markdown",
          storageId: "storage:1" as never,
        },
      ],
    });

    expect(ctx.db.patch).toHaveBeenCalledWith("skillPublishUploadTickets:1", { usedAt: 2_000 });
  });

  it("rejects a ticket whose staged file does not match the publish", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const ctx = makeCtx({
      _id: "skillPublishUploadTickets:1",
      userId: "users:1",
      path: "SKILL.md",
      size: 5,
      sha256: "a".repeat(64),
      storageId: "storage:1",
      expiresAt: 10_000,
    });

    await expect(
      consumeSkillPublishUploads(ctx as never, {
        userId: "users:1" as never,
        uploadTickets: ["skillPublishUploadTickets:1" as never],
        files: [
          {
            path: "SKILL.md",
            size: 6,
            sha256: "a".repeat(64),
            storageId: "storage:1" as never,
          },
        ],
      }),
    ).rejects.toThrow("does not match this publish");
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("deletes an abandoned staged file when its ticket expires", async () => {
    const ctx = makeCtx({
      _id: "skillPublishUploadTickets:1",
      storageId: "storage:1",
    });

    await cleanupHandler(ctx, { uploadTicket: "skillPublishUploadTickets:1" });

    expect(ctx.storage.delete).toHaveBeenCalledWith("storage:1");
    expect(ctx.db.delete).toHaveBeenCalledWith("skillPublishUploadTickets:1");
  });

  it("keeps published storage when deleting a consumed ticket", async () => {
    const ctx = makeCtx({
      _id: "skillPublishUploadTickets:1",
      storageId: "storage:1",
      usedAt: 2_000,
    });

    await cleanupHandler(ctx, { uploadTicket: "skillPublishUploadTickets:1" });

    expect(ctx.storage.delete).not.toHaveBeenCalled();
    expect(ctx.db.delete).toHaveBeenCalledWith("skillPublishUploadTickets:1");
  });
});
