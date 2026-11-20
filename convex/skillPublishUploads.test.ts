/* @vitest-environment node */

import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "../src/__tests__/helpers/convexDb";
import { getTestHandler } from "../src/__tests__/helpers/convexHandler";
import {
  attachSkillPublishUploadInternal,
  cleanupSkillPublishUploadInternal,
  consumeSkillPublishUploads,
} from "./skillPublishUploads";

const attachHandler = getTestHandler<{
  userId: "users:1";
  uploadTicket: "skillPublishUploadTickets:1";
  storageId: "storage:1";
}>(attachSkillPublishUploadInternal);
const cleanupHandler = getTestHandler<{ uploadTicket: "skillPublishUploadTickets:1" }>(
  cleanupSkillPublishUploadInternal,
);
const HELLO_SHA256_HEX = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const HELLO_SHA256_BASE64 = "LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=";

function makeCtx(
  ticket: Record<string, unknown> | null,
  metadata: Record<string, unknown> | null = null,
) {
  return {
    db: {
      ...createMockDb(),
      get: vi.fn(async () => ticket),
      system: { get: vi.fn(async () => metadata), query: vi.fn() },
    },
    storage: { delete: vi.fn() },
  };
}

function makeAttachCtx(storageSha256: string) {
  return makeCtx(
    {
      _id: "skillPublishUploadTickets:1",
      userId: "users:1",
      path: "SKILL.md",
      size: 5,
      sha256: HELLO_SHA256_HEX,
      contentType: "text/markdown",
      createdAt: 1_000,
      expiresAt: 10_000,
    },
    {
      _creationTime: 1_500,
      size: 5,
      sha256: storageSha256,
      contentType: "text/markdown",
    },
  );
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

    const rejected = consumeSkillPublishUploads(ctx as never, {
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
    });
    await expect(rejected).rejects.toBeInstanceOf(ConvexError);
    await expect(rejected).rejects.toThrow("does not match this publish");
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it.each([
    ["base64", HELLO_SHA256_BASE64],
    ["hex", HELLO_SHA256_HEX],
  ])("attaches an upload when Convex reports its SHA-256 as %s", async (_format, sha256) => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const ctx = makeAttachCtx(sha256);

    await attachHandler(ctx, {
      userId: "users:1",
      uploadTicket: "skillPublishUploadTickets:1",
      storageId: "storage:1",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith("skillPublishUploadTickets:1", {
      storageId: "storage:1",
    });
  });

  it("rejects an upload whose base64 SHA-256 does not match its ticket", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const ctx = makeAttachCtx("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");

    await expect(
      attachHandler(ctx, {
        userId: "users:1",
        uploadTicket: "skillPublishUploadTickets:1",
        storageId: "storage:1",
      }),
    ).rejects.toThrow("does not match its skill upload ticket");
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
