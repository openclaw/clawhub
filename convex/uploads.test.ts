/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumePackagePublishUploadTicketInternal,
  createPackagePublishUploadForTokenInternal,
} from "./uploads";

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
const createForTokenHandler = (
  createPackagePublishUploadForTokenInternal as unknown as WrappedHandler<{
    publishTokenId: string;
  }>
)._handler;

function makeCtx(
  document: Record<string, unknown> | null | ((id: string) => Record<string, unknown> | null),
  storage: Record<string, unknown> | null = null,
) {
  return {
    db: {
      get: vi.fn(async (id: string) => (typeof document === "function" ? document(id) : document)),
      insert: vi.fn(async () => "packagePublishUploadTickets:1"),
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
    storage: {
      generateUploadUrl: vi.fn(async () => "https://upload.example"),
    },
  };
}

function makeGitHubPublishToken(overrides: Record<string, unknown> = {}) {
  return {
    _id: "packagePublishTokens:publish",
    repository: "openclaw/openclaw",
    authorizationVersion: 2,
    authorizationTransactionKey: "transaction:1",
    scope: "publish",
    expiresAt: 10_000,
    ...overrides,
  };
}

function makeGitHubUploadTicket(overrides: Record<string, unknown> = {}) {
  return {
    _id: "packagePublishUploadTickets:1",
    kind: "github-actions",
    publishTokenId: "packagePublishTokens:upload",
    authorizationTransactionKey: "transaction:1",
    createdAt: 1_000,
    expiresAt: 10_000,
    ...overrides,
  };
}

function makeGitHubCtx(
  ticket: Record<string, unknown>,
  token: Record<string, unknown>,
  storage: Record<string, unknown> | null = { _id: "storage:1", _creationTime: 1_500 },
) {
  return makeCtx((id) => (id.startsWith("packagePublishUploadTickets:") ? ticket : token), storage);
}

describe("package publish upload tickets", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("atomically consumes a v2 upload capability when creating its ticket", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const ctx = makeCtx({
      _id: "packagePublishTokens:1",
      repository: "openclaw/openclaw",
      authorizationVersion: 2,
      authorizationTransactionKey: "transaction:1",
      scope: "upload",
      expiresAt: 10_000,
    });

    await expect(
      createForTokenHandler(ctx, { publishTokenId: "packagePublishTokens:1" }),
    ).resolves.toEqual({
      uploadUrl: "https://upload.example",
      uploadTicket: "packagePublishUploadTickets:1",
    });

    expect(ctx.db.insert).toHaveBeenCalledWith("packagePublishUploadTickets", {
      kind: "github-actions",
      publishTokenId: "packagePublishTokens:1",
      authorizationTransactionKey: "transaction:1",
      createdAt: 2_000,
      expiresAt: 902_000,
    });
    expect(ctx.db.patch).toHaveBeenCalledWith("packagePublishTokens:1", {
      consumedAt: 2_000,
    });
  });

  it("rejects publish-scoped and consumed capabilities for package upload", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const publishCtx = makeCtx({
      _id: "packagePublishTokens:1",
      authorizationVersion: 2,
      scope: "publish",
      expiresAt: 10_000,
    });
    await expect(
      createForTokenHandler(publishCtx, { publishTokenId: "packagePublishTokens:1" }),
    ).rejects.toThrow("Trusted publish token cannot authorize package upload");

    const consumedCtx = makeCtx({
      _id: "packagePublishTokens:2",
      authorizationVersion: 2,
      scope: "upload",
      consumedAt: 1_500,
      expiresAt: 10_000,
    });
    await expect(
      createForTokenHandler(consumedCtx, { publishTokenId: "packagePublishTokens:2" }),
    ).rejects.toThrow("Trusted publish token is missing or expired");
  });

  it("rejects legacy OpenClaw upload tokens minted before the v2 cutover", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const ctx = makeCtx({
      _id: "packagePublishTokens:legacy",
      repository: "openclaw/openclaw",
      expiresAt: 10_000,
    });

    await expect(
      createForTokenHandler(ctx, { publishTokenId: "packagePublishTokens:legacy" }),
    ).rejects.toThrow("OpenClaw trusted publishes require authorization version 2");

    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("rejects scoped upload capabilities without a server transaction key", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const ctx = makeCtx({
      _id: "packagePublishTokens:1",
      scope: "upload",
      expiresAt: 10_000,
    });

    await expect(
      createForTokenHandler(ctx, { publishTokenId: "packagePublishTokens:1" }),
    ).rejects.toThrow("Scoped trusted publish authorization is missing its transaction key");

    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
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

  it("allows a distinct publish token from the same authorization transaction", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const ctx = makeGitHubCtx(makeGitHubUploadTicket(), makeGitHubPublishToken());

    await consumeHandler(ctx, {
      uploadTicket: "packagePublishUploadTickets:1",
      storageId: "storage:1",
      auth: { kind: "github-actions", publishTokenId: "packagePublishTokens:publish" },
    });

    expect(ctx.db.patch).toHaveBeenCalledWith("packagePublishUploadTickets:1", {
      usedAt: 2_000,
      storageId: "storage:1",
    });
  });

  it("rejects a publish token from another authorization transaction", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const ctx = makeGitHubCtx(
      makeGitHubUploadTicket(),
      makeGitHubPublishToken({ authorizationTransactionKey: "transaction:2" }),
    );

    await expect(
      consumeHandler(ctx, {
        uploadTicket: "packagePublishUploadTickets:1",
        storageId: "storage:1",
        auth: { kind: "github-actions", publishTokenId: "packagePublishTokens:publish" },
      }),
    ).rejects.toThrow("Package tarball upload ticket does not match this publish transaction");

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it.each([
    ["revoked", { revokedAt: 1_500 }],
    ["expired", { expiresAt: 2_000 }],
    ["consumed", { consumedAt: 1_500 }],
  ])("rejects a %s publish token for a fresh upload ticket", async (_label, tokenPatch) => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const ctx = makeGitHubCtx(makeGitHubUploadTicket(), makeGitHubPublishToken(tokenPatch));

    await expect(
      consumeHandler(ctx, {
        uploadTicket: "packagePublishUploadTickets:1",
        storageId: "storage:1",
        auth: { kind: "github-actions", publishTokenId: "packagePublishTokens:publish" },
      }),
    ).rejects.toThrow("Trusted publish token is missing, expired, or consumed");

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it.each([
    [
      "ticket",
      makeGitHubUploadTicket({ authorizationTransactionKey: undefined }),
      makeGitHubPublishToken(),
    ],
    [
      "token",
      makeGitHubUploadTicket(),
      makeGitHubPublishToken({ authorizationTransactionKey: undefined }),
    ],
  ])(
    "rejects a scoped publish with a missing %s transaction key",
    async (_label, ticket, token) => {
      vi.spyOn(Date, "now").mockReturnValue(2_000);
      const ctx = makeGitHubCtx(ticket, token);

      await expect(
        consumeHandler(ctx, {
          uploadTicket: "packagePublishUploadTickets:1",
          storageId: "storage:1",
          auth: { kind: "github-actions", publishTokenId: "packagePublishTokens:publish" },
        }),
      ).rejects.toThrow("Scoped trusted publish authorization is missing its transaction key");
    },
  );

  it("rejects an upload-scoped token at package publication", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const ctx = makeGitHubCtx(
      makeGitHubUploadTicket(),
      makeGitHubPublishToken({ scope: "upload" }),
    );

    await expect(
      consumeHandler(ctx, {
        uploadTicket: "packagePublishUploadTickets:1",
        storageId: "storage:1",
        auth: { kind: "github-actions", publishTokenId: "packagePublishTokens:publish" },
      }),
    ).rejects.toThrow("Trusted upload token cannot authorize package publication");
  });

  it("rejects an OpenClaw publish token without v2 authorization", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const ctx = makeGitHubCtx(
      makeGitHubUploadTicket(),
      makeGitHubPublishToken({ authorizationVersion: undefined }),
    );

    await expect(
      consumeHandler(ctx, {
        uploadTicket: "packagePublishUploadTickets:1",
        storageId: "storage:1",
        auth: { kind: "github-actions", publishTokenId: "packagePublishTokens:publish" },
      }),
    ).rejects.toThrow("OpenClaw trusted publishes require authorization version 2");
  });

  it("allows an idempotent same-storage replay after the publish token was consumed", async () => {
    vi.spyOn(Date, "now").mockReturnValue(3_000);
    const ctx = makeGitHubCtx(
      makeGitHubUploadTicket({ usedAt: 2_000, storageId: "storage:1" }),
      makeGitHubPublishToken({ consumedAt: 2_500 }),
    );

    await consumeHandler(ctx, {
      uploadTicket: "packagePublishUploadTickets:1",
      storageId: "storage:1",
      auth: { kind: "github-actions", publishTokenId: "packagePublishTokens:publish" },
    });

    expect(ctx.db.system.get).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("rejects replaying a used ticket with different storage", async () => {
    vi.spyOn(Date, "now").mockReturnValue(3_000);
    const ctx = makeGitHubCtx(
      makeGitHubUploadTicket({ usedAt: 2_000, storageId: "storage:1" }),
      makeGitHubPublishToken({ consumedAt: 2_500 }),
      { _id: "storage:2", _creationTime: 2_500 },
    );

    await expect(
      consumeHandler(ctx, {
        uploadTicket: "packagePublishUploadTickets:1",
        storageId: "storage:2",
        auth: { kind: "github-actions", publishTokenId: "packagePublishTokens:publish" },
      }),
    ).rejects.toThrow("Package tarball upload ticket was already used");

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("rejects storage created before the upload ticket", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const ctx = makeGitHubCtx(makeGitHubUploadTicket(), makeGitHubPublishToken(), {
      _id: "storage:1",
      _creationTime: 999,
    });

    await expect(
      consumeHandler(ctx, {
        uploadTicket: "packagePublishUploadTickets:1",
        storageId: "storage:1",
        auth: { kind: "github-actions", publishTokenId: "packagePublishTokens:publish" },
      }),
    ).rejects.toThrow("Package tarball upload must be created after its upload ticket");

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});
