/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthTokenModuleMocks,
  createHttpModuleMocks,
  createRegistryModuleMocks,
  createUiModuleMocks,
  makeGlobalOpts,
} from "../../../clawhub/test/cliCommandTestKit.js";

const authTokenMocks = createAuthTokenModuleMocks();
const registryMocks = createRegistryModuleMocks();
const httpMocks = createHttpModuleMocks();
const uiMocks = createUiModuleMocks();

vi.mock("../../../clawhub/src/cli/authToken.js", () => authTokenMocks.moduleFactory());
vi.mock("../../../clawhub/src/cli/registry.js", () => registryMocks.moduleFactory());
vi.mock("../../../clawhub/src/http.js", () => httpMocks.moduleFactory());
vi.mock("../../../clawhub/src/cli/ui.js", () => uiMocks.moduleFactory());

const { cmdBanUser, cmdReclassifyBan, cmdRemediateAutobans, cmdSetRole, cmdUnbanUser } =
  await import("./moderation");

afterEach(() => {
  vi.clearAllMocks();
});

describe("cmdBanUser", () => {
  it("requires --yes when input is disabled", async () => {
    await expect(cmdBanUser(makeGlobalOpts(), "demo", {}, false)).rejects.toThrow(/--yes/i);
  });

  it("posts handle payload", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      alreadyBanned: false,
      deletedSkills: 1,
    });
    await cmdBanUser(makeGlobalOpts(), "hightower6eu", { yes: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/ban",
        body: { handle: "hightower6eu" },
      }),
      expect.anything(),
    );
  });

  it("includes reason when provided", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      alreadyBanned: false,
      deletedSkills: 0,
    });
    await cmdBanUser(
      makeGlobalOpts(),
      "hightower6eu",
      { yes: true, reason: "malware distribution" },
      false,
    );
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/ban",
        body: { handle: "hightower6eu", reason: "malware distribution" },
      }),
      expect.anything(),
    );
  });

  it("posts user id payload when --id is set", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      alreadyBanned: false,
      deletedSkills: 0,
    });
    await cmdBanUser(makeGlobalOpts(), "user_123", { yes: true, id: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/ban",
        body: { userId: "user_123" },
      }),
      expect.anything(),
    );
  });

  it("resolves user via fuzzy search", async () => {
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            userId: "users_123",
            handle: "moonshine-100rze",
            displayName: null,
            name: null,
            role: "user",
          },
        ],
        total: 1,
      })
      .mockResolvedValueOnce({ ok: true, alreadyBanned: false, deletedSkills: 0 });
    await cmdBanUser(makeGlobalOpts(), "moonshine-100rze", { yes: true, fuzzy: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        method: "GET",
        url: expect.stringContaining("/api/v1/users?"),
      }),
      expect.anything(),
    );
    expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/ban",
        body: { userId: "users_123" },
      }),
      expect.anything(),
    );
  });

  it("fails fuzzy search with multiple matches when not interactive", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      items: [
        {
          userId: "users_1",
          handle: "moonshine-100rze",
          displayName: null,
          name: null,
          role: null,
        },
        {
          userId: "users_2",
          handle: "moonshine-100rze2",
          displayName: null,
          name: null,
          role: null,
        },
      ],
      total: 2,
    });
    await expect(
      cmdBanUser(makeGlobalOpts(), "moonshine", { yes: true, fuzzy: true }, false),
    ).rejects.toThrow(/multiple users matched/i);
  });
});

describe("cmdSetRole", () => {
  it("requires --yes when input is disabled", async () => {
    await expect(cmdSetRole(makeGlobalOpts(), "demo", "moderator", {}, false)).rejects.toThrow(
      /--yes/i,
    );
  });

  it("rejects invalid roles", async () => {
    await expect(
      cmdSetRole(makeGlobalOpts(), "demo", "owner", { yes: true }, false),
    ).rejects.toThrow(/role/i);
  });

  it("posts handle payload", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true, role: "moderator" });
    await cmdSetRole(makeGlobalOpts(), "hightower6eu", "moderator", { yes: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/role",
        body: { handle: "hightower6eu", role: "moderator" },
      }),
      expect.anything(),
    );
  });

  it("posts user id payload when --id is set", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true, role: "admin" });
    await cmdSetRole(makeGlobalOpts(), "user_123", "admin", { yes: true, id: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/role",
        body: { userId: "user_123", role: "admin" },
      }),
      expect.anything(),
    );
  });
});

describe("cmdUnbanUser", () => {
  it("requires --yes when input is disabled", async () => {
    await expect(cmdUnbanUser(makeGlobalOpts(), "demo", {}, false)).rejects.toThrow(/--yes/i);
  });

  it("posts handle payload", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      alreadyUnbanned: false,
      restoredSkills: 1,
    });
    await cmdUnbanUser(makeGlobalOpts(), "hightower6eu", { yes: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/unban",
        body: { handle: "hightower6eu" },
      }),
      expect.anything(),
    );
  });

  it("includes reason when provided", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      alreadyUnbanned: false,
      restoredSkills: 0,
    });
    await cmdUnbanUser(
      makeGlobalOpts(),
      "hightower6eu",
      { yes: true, reason: "appeal accepted" },
      false,
    );
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/unban",
        body: { handle: "hightower6eu", reason: "appeal accepted" },
      }),
      expect.anything(),
    );
  });

  it("posts user id payload when --id is set", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      alreadyUnbanned: false,
      restoredSkills: 0,
    });
    await cmdUnbanUser(makeGlobalOpts(), "user_123", { yes: true, id: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/unban",
        body: { userId: "user_123" },
      }),
      expect.anything(),
    );
  });

  it("resolves user via fuzzy search", async () => {
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            userId: "users_123",
            handle: "moonshine-100rze",
            displayName: null,
            name: null,
            role: "user",
          },
        ],
        total: 1,
      })
      .mockResolvedValueOnce({ ok: true, alreadyUnbanned: false, restoredSkills: 0 });
    await cmdUnbanUser(makeGlobalOpts(), "moonshine-100rze", { yes: true, fuzzy: true }, false);
    expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        method: "GET",
        url: expect.stringContaining("/api/v1/users?"),
      }),
      expect.anything(),
    );
    expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/unban",
        body: { userId: "users_123" },
      }),
      expect.anything(),
    );
  });
});

describe("cmdRemediateAutobans", () => {
  it("defaults to dry run and posts no target payload", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      dryRun: true,
      scanned: 0,
      wouldUnban: 0,
      unbanned: 0,
      skipped: 0,
      restoredSkills: 0,
      restoredPackages: 0,
      items: [],
      nextCursor: null,
      done: true,
    });

    await cmdRemediateAutobans(makeGlobalOpts(), {}, false);

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/remediate-autobans",
        body: { dryRun: true },
      }),
      expect.anything(),
    );
  });

  it("posts apply payload with target, reason, since, limit, and id mode", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      dryRun: false,
      scanned: 1,
      wouldUnban: 0,
      unbanned: 1,
      skipped: 0,
      restoredSkills: 12,
      restoredPackages: 0,
      items: [],
      nextCursor: null,
      done: true,
    });

    await cmdRemediateAutobans(
      makeGlobalOpts(),
      {
        apply: true,
        user: "users:target",
        id: true,
        reason: "appeal accepted",
        since: "2026-05-12",
        limit: "5",
      },
      false,
    );

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/remediate-autobans",
        body: {
          dryRun: false,
          userId: "users:target",
          reason: "appeal accepted",
          since: "2026-05-12",
          limit: 5,
        },
      }),
      expect.anything(),
    );
  });

  it("rejects conflicting apply and dry-run flags", async () => {
    await expect(
      cmdRemediateAutobans(makeGlobalOpts(), { apply: true, dryRun: true }, false),
    ).rejects.toThrow(/either --apply or --dry-run/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("can dry-run autoban remediation across all pages", async () => {
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        ok: true,
        dryRun: true,
        scanned: 10,
        wouldUnban: 9,
        unbanned: 0,
        skipped: 1,
        restoredSkills: 12,
        restoredPackages: 0,
        items: [{ handle: "first" }],
        nextCursor: "cursor-2",
        done: false,
      })
      .mockResolvedValueOnce({
        ok: true,
        dryRun: true,
        scanned: 3,
        wouldUnban: 3,
        unbanned: 0,
        skipped: 0,
        restoredSkills: 4,
        restoredPackages: 1,
        items: [{ handle: "second" }],
        nextCursor: null,
        done: true,
      });

    const result = await cmdRemediateAutobans(
      makeGlobalOpts(),
      { all: true, limit: "10", json: true },
      false,
    );

    expect(httpMocks.apiRequest).toHaveBeenCalledTimes(2);
    expect(httpMocks.apiRequest.mock.calls[0]?.[1]).toMatchObject({
      body: { dryRun: true, limit: 10 },
    });
    expect(httpMocks.apiRequest.mock.calls[1]?.[1]).toMatchObject({
      body: { dryRun: true, limit: 10, cursor: "cursor-2" },
    });
    expect(result).toMatchObject({
      scanned: 13,
      wouldUnban: 12,
      skipped: 1,
      restoredSkills: 16,
      restoredPackages: 1,
      done: true,
    });
  });

  it("rejects combining all pages with a targeted user", async () => {
    await expect(
      cmdRemediateAutobans(makeGlobalOpts(), { all: true, user: "demo" }, false),
    ).rejects.toThrow(/either --all or --user/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });
});

describe("cmdReclassifyBan", () => {
  it("defaults to dry run and posts handle payload", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      dryRun: true,
      userId: "users:target",
      handle: "hanxueyuan",
      previousReason: "malware auto-ban",
      nextReason: "bulk publishing spam",
      changed: true,
    });

    await cmdReclassifyBan(
      makeGlobalOpts(),
      "hanxueyuan",
      { reason: "bulk publishing spam" },
      false,
    );

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/reclassify-ban",
        body: { handle: "hanxueyuan", reason: "bulk publishing spam", dryRun: true },
      }),
      expect.anything(),
    );
  });

  it("posts apply payload with user id when --id is set", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      dryRun: false,
      userId: "users:target",
      handle: null,
      previousReason: "malware auto-ban",
      nextReason: "bulk publishing spam",
      changed: true,
    });

    await cmdReclassifyBan(
      makeGlobalOpts(),
      "users:target",
      { id: true, apply: true, yes: true, reason: "bulk publishing spam" },
      false,
    );

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/reclassify-ban",
        body: { userId: "users:target", reason: "bulk publishing spam", dryRun: false },
      }),
      expect.anything(),
    );
  });

  it("requires a reason", async () => {
    await expect(cmdReclassifyBan(makeGlobalOpts(), "hanxueyuan", {}, false)).rejects.toThrow(
      /reason/i,
    );
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("requires --yes for apply when input is disabled", async () => {
    await expect(
      cmdReclassifyBan(
        makeGlobalOpts(),
        "hanxueyuan",
        { apply: true, reason: "bulk publishing spam" },
        false,
      ),
    ).rejects.toThrow(/--yes/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });
});
