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

const {
  cmdBanUser,
  cmdLiftModerationHold,
  cmdRecoverPersonalPublisher,
  cmdReclassifyBan,
  cmdRepairVtPendingSkills,
  cmdRevokeSkillVersion,
  cmdRescanAllSkills,
  cmdRescanSkill,
  cmdSetRole,
  cmdUnbanUser,
} = await import("./moderation");

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

describe("cmdRescanSkill", () => {
  it("requires --yes when input is disabled", async () => {
    await expect(cmdRescanSkill(makeGlobalOpts(), "demo", {}, false)).rejects.toThrow(/--yes/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("posts a moderator skill rescan request", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      scanId: "skillScanRequests:1",
      jobId: "securityScanJobs:1",
      status: "queued",
      sourceKind: "published",
      update: true,
    });

    const result = await cmdRescanSkill(
      makeGlobalOpts(),
      "Markdown2Doc",
      { yes: true, version: "1.0.4" },
      false,
    );

    expect(result).toMatchObject({ ok: true, scanId: "skillScanRequests:1", update: true });
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/-/scan",
        token: "tkn",
        body: {
          source: { kind: "published", slug: "markdown2doc", version: "1.0.4" },
          update: true,
        },
      }),
      expect.anything(),
    );
  });
});

describe("cmdRevokeSkillVersion", () => {
  it("requires --yes when input is disabled", async () => {
    await expect(
      cmdRevokeSkillVersion(
        makeGlobalOpts(),
        "demo",
        { version: "1.0.0", reason: "confirmed unsafe artifact" },
        false,
      ),
    ).rejects.toThrow(/--yes/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("posts an exact-version revocation request", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      slug: "demo",
      version: "1.0.0",
      skillId: "skills:1",
      versionId: "skillVersions:1",
      alreadyRevoked: false,
      replacementVersion: null,
      skillHidden: true,
    });

    const result = await cmdRevokeSkillVersion(
      makeGlobalOpts(),
      "Demo",
      { version: "1.0.0", reason: "confirmed unsafe artifact", yes: true },
      false,
    );

    expect(result).toMatchObject({
      ok: true,
      slug: "demo",
      version: "1.0.0",
      skillHidden: true,
    });
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/demo/versions/1.0.0/moderation",
        token: "tkn",
        body: { state: "revoked", reason: "confirmed unsafe artifact" },
      }),
      expect.anything(),
    );
  });

  it("passes an owner qualifier for duplicate slugs", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      slug: "demo",
      version: "1.0.0",
      skillId: "skills:1",
      versionId: "skillVersions:1",
      alreadyRevoked: false,
      replacementVersion: null,
      skillHidden: true,
    });

    await cmdRevokeSkillVersion(
      makeGlobalOpts(),
      "demo",
      {
        version: "1.0.0",
        reason: "confirmed unsafe artifact",
        owner: "@publisher",
        yes: true,
      },
      false,
    );

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: {
          state: "revoked",
          reason: "confirmed unsafe artifact",
          ownerHandle: "publisher",
        },
      }),
      expect.anything(),
    );
  });
});

describe("cmdRescanAllSkills", () => {
  it("requires --yes for real runs when input is disabled", async () => {
    await expect(cmdRescanAllSkills(makeGlobalOpts(), {}, false)).rejects.toThrow(/--yes/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("pages dry-runs without polling status", async () => {
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        ok: true,
        mode: "all-active-latest",
        queued: 2,
        alreadyQueued: 0,
        skipped: 0,
        jobIds: [],
        nextCursor: "cursor-2",
        done: false,
        sampleSlugs: ["one", "two"],
      })
      .mockResolvedValueOnce({
        ok: true,
        mode: "all-active-latest",
        queued: 1,
        alreadyQueued: 1,
        skipped: 0,
        jobIds: [],
        nextCursor: null,
        done: true,
        sampleSlugs: ["three", "four"],
      });

    const result = await cmdRescanAllSkills(
      makeGlobalOpts(),
      { dryRun: true, batchSize: 2 },
      false,
    );

    expect(result).toMatchObject({ ok: true, batches: 2, queued: 3, alreadyQueued: 1 });
    expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
      1,
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/-/scan/batch",
        body: {
          mode: "all-active-latest",
          cursor: null,
          batchSize: 2,
          dryRun: true,
        },
      }),
      expect.anything(),
    );
    expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
      2,
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/-/scan/batch",
        body: {
          mode: "all-active-latest",
          cursor: "cursor-2",
          batchSize: 2,
          dryRun: true,
        },
      }),
      expect.anything(),
    );
  });

  it("queues a batch and polls until drained", async () => {
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        ok: true,
        mode: "all-active-latest",
        queued: 1,
        alreadyQueued: 0,
        skipped: 0,
        jobIds: ["securityScanJobs:1"],
        nextCursor: null,
        done: true,
        sampleSlugs: ["one"],
      })
      .mockResolvedValueOnce({
        ok: true,
        total: 1,
        queued: 0,
        running: 0,
        succeeded: 1,
        failed: 0,
        missing: 0,
        terminal: 1,
        done: true,
        failedJobIds: [],
      });

    const result = await cmdRescanAllSkills(
      makeGlobalOpts(),
      { yes: true, batchSize: 2, pollInterval: 0 },
      false,
    );

    expect(result).toMatchObject({ ok: true, batches: 1, queued: 1, failed: 0 });
    expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
      1,
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/-/scan/batch",
        token: "tkn",
        body: {
          mode: "all-active-latest",
          cursor: null,
          batchSize: 2,
          dryRun: false,
        },
      }),
      expect.anything(),
    );
    expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
      2,
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/-/scan/batch/status",
        token: "tkn",
        body: { jobIds: ["securityScanJobs:1"] },
      }),
      expect.anything(),
    );
  });

  it("prints human-readable progress and summary by default", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      httpMocks.apiRequest
        .mockResolvedValueOnce({
          ok: true,
          mode: "all-active-latest",
          queued: 1,
          alreadyQueued: 1,
          skipped: 1,
          jobIds: ["securityScanJobs:1"],
          nextCursor: null,
          done: true,
          sampleSlugs: ["one"],
        })
        .mockResolvedValueOnce({
          ok: true,
          total: 1,
          queued: 0,
          running: 0,
          succeeded: 1,
          failed: 0,
          missing: 0,
          terminal: 1,
          done: true,
          failedJobIds: [],
        });

      await cmdRescanAllSkills(
        makeGlobalOpts(),
        { yes: true, batchSize: 3, pollInterval: 0 },
        false,
      );

      expect(consoleLog).toHaveBeenCalledWith("Batch 1: queued 1, already queued 1, skipped 1.");
      expect(consoleLog).toHaveBeenCalledWith(
        "Batch 1 status: 1 succeeded, 0 failed, 0 running, 0 queued.",
      );
      expect(consoleLog).toHaveBeenCalledWith(
        "Bulk rescan finished: 1 batch(es), 1 queued, 1 already queued, 1 skipped, 0 failed.",
      );
    } finally {
      consoleLog.mockRestore();
    }
  });

  it("fails when drained batches contain failed jobs", async () => {
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        ok: true,
        mode: "all-active-latest",
        queued: 1,
        alreadyQueued: 0,
        skipped: 0,
        jobIds: ["securityScanJobs:1"],
        nextCursor: null,
        done: true,
        sampleSlugs: ["one"],
      })
      .mockResolvedValueOnce({
        ok: true,
        total: 1,
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 1,
        missing: 0,
        terminal: 1,
        done: true,
        failedJobIds: ["securityScanJobs:1"],
      });

    await expect(
      cmdRescanAllSkills(makeGlobalOpts(), { yes: true, batchSize: 1, pollInterval: 0 }, false),
    ).rejects.toThrow(/failed job/i);
  });
});

describe("cmdRepairVtPendingSkills", () => {
  it("requires --yes for real runs when input is disabled", async () => {
    await expect(cmdRepairVtPendingSkills(makeGlobalOpts(), {}, false)).rejects.toThrow(/--yes/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("pages dry-runs without confirmation", async () => {
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        ok: true,
        dryRun: true,
        total: 2,
        wouldUpdate: 2,
        updated: 0,
        noResults: 0,
        noDecisiveStats: 0,
        errors: 0,
        done: false,
        cursor: "cursor-2",
        statusCounts: { clean: 2 },
        sampleUpdated: [{ slug: "one", status: "clean" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        dryRun: true,
        total: 1,
        wouldUpdate: 1,
        updated: 0,
        noResults: 0,
        noDecisiveStats: 0,
        errors: 0,
        done: true,
        cursor: null,
        statusCounts: { suspicious: 1 },
        sampleUpdated: [{ slug: "two", status: "suspicious" }],
      });

    const result = await cmdRepairVtPendingSkills(
      makeGlobalOpts(),
      { dryRun: true, batchSize: 2, all: true },
      false,
    );

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      batches: 2,
      total: 3,
      wouldUpdate: 3,
      updated: 0,
      statusCounts: { clean: 2, suspicious: 1 },
    });
    expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
      1,
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/-/repair-vt-pending",
        token: "tkn",
        body: {
          cursor: null,
          batchSize: 2,
          dryRun: true,
        },
      }),
      expect.anything(),
    );
    expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
      2,
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/-/repair-vt-pending",
        token: "tkn",
        body: {
          cursor: "cursor-2",
          batchSize: 2,
          dryRun: true,
        },
      }),
      expect.anything(),
    );
  });

  it("writes one batch when confirmed", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      dryRun: false,
      total: 2,
      wouldUpdate: 2,
      updated: 2,
      noResults: 0,
      noDecisiveStats: 0,
      errors: 0,
      done: false,
      cursor: "cursor-2",
      statusCounts: { clean: 1, malicious: 1 },
      sampleUpdated: [
        { slug: "one", status: "clean" },
        { slug: "two", status: "malicious" },
      ],
    });

    const result = await cmdRepairVtPendingSkills(
      makeGlobalOpts(),
      { yes: true, batchSize: 2 },
      false,
    );

    expect(result).toMatchObject({
      ok: true,
      dryRun: false,
      batches: 1,
      total: 2,
      wouldUpdate: 2,
      updated: 2,
      nextCursor: "cursor-2",
      done: false,
    });
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/-/repair-vt-pending",
        token: "tkn",
        body: {
          cursor: null,
          batchSize: 2,
          dryRun: false,
        },
      }),
      expect.anything(),
    );
  });
});

describe("cmdRecoverPersonalPublisher", () => {
  it("plans publisher recovery by default", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      dryRun: true,
      recovered: false,
      publisherId: "publishers:gingiris",
      handle: "gingiris",
      previousUser: {
        userId: "users:legacy",
        handle: "gingiris",
        nextHandle: "gingiris-recovered",
        githubProviderAccountId: "111",
        authAccountCount: 1,
      },
      nextUser: {
        userId: "users:current",
        handle: "gingiris-1031",
        nextHandle: "gingiris",
        githubProviderAccountId: "222",
        authAccountCount: 1,
      },
      retiredPersonalPublisher: null,
      resourceOwnerMigration: {
        limitPerTable: 100,
        skills: 1,
        skillSlugAliases: 1,
        packages: 0,
        packageInspectorWarnings: 0,
        githubSourcesChecked: 1,
        handleReservations: 1,
      },
      identityVerified: false,
      reason: "Verified account continuity",
    });

    await cmdRecoverPersonalPublisher(
      makeGlobalOpts(),
      "@Gingiris",
      {
        to: "@Gingiris-1031",
        previousGithubId: "111",
        nextGithubId: "222",
        reason: "Verified account continuity",
      },
      false,
    );

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/publisher-recovery",
        token: "tkn",
        body: {
          handle: "gingiris",
          nextUserHandle: "gingiris-1031",
          previousGitHubProviderAccountId: "111",
          nextGitHubProviderAccountId: "222",
          reason: "Verified account continuity",
          confirmIdentityVerified: false,
          dryRun: true,
        },
      }),
      expect.anything(),
    );
  });

  it("requires --verified before applying recovery", async () => {
    await expect(
      cmdRecoverPersonalPublisher(
        makeGlobalOpts(),
        "gingiris",
        {
          to: "gingiris-1031",
          previousGithubId: "111",
          nextGithubId: "222",
          reason: "Verified account continuity",
          apply: true,
          yes: true,
        },
        false,
      ),
    ).rejects.toThrow(/--verified/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("sends verified recovery details when applying", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      dryRun: false,
      recovered: true,
      publisherId: "publishers:gingiris",
      handle: "gingiris",
      previousUser: {
        userId: "users:legacy",
        handle: "gingiris-recovered",
        nextHandle: "gingiris-recovered",
        githubProviderAccountId: "111",
        authAccountCount: 1,
      },
      nextUser: {
        userId: "users:current",
        handle: "gingiris",
        nextHandle: "gingiris",
        githubProviderAccountId: "222",
        authAccountCount: 1,
      },
      retiredPersonalPublisher: null,
      resourceOwnerMigration: {
        limitPerTable: 100,
        skills: 1,
        skillSlugAliases: 1,
        packages: 0,
        packageInspectorWarnings: 0,
        githubSourcesChecked: 1,
        handleReservations: 1,
      },
      identityVerified: true,
      reason: "Verified account continuity",
    });

    await cmdRecoverPersonalPublisher(
      makeGlobalOpts(),
      "gingiris",
      {
        to: "gingiris-1031",
        previousGithubId: "111",
        nextGithubId: "222",
        retiredHandle: "gingiris-recovered",
        reason: "Verified account continuity",
        apply: true,
        verified: true,
        yes: true,
      },
      false,
    );

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/publisher-recovery",
        body: {
          handle: "gingiris",
          nextUserHandle: "gingiris-1031",
          previousGitHubProviderAccountId: "111",
          nextGitHubProviderAccountId: "222",
          retiredUserHandle: "gingiris-recovered",
          reason: "Verified account continuity",
          confirmIdentityVerified: true,
          dryRun: false,
        },
      }),
      expect.anything(),
    );
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

describe("cmdLiftModerationHold", () => {
  it("requires an audit reason", async () => {
    await expect(
      cmdLiftModerationHold(makeGlobalOpts(), "demo", { yes: true }, false),
    ).rejects.toThrow(/--reason required/i);
  });

  it("requires --yes when input is disabled", async () => {
    await expect(
      cmdLiftModerationHold(makeGlobalOpts(), "demo", { reason: "false positive" }, false),
    ).rejects.toThrow(/--yes/i);
  });

  it("posts user id and reason", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      alreadyCleared: false,
      restoredSkills: 1,
      scheduledSkills: false,
    });
    await cmdLiftModerationHold(
      makeGlobalOpts(),
      "users_123",
      {
        id: true,
        reason: "Issue #3008 false positive",
        yes: true,
        json: true,
      },
      false,
    );
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/lift-moderation-hold",
        body: {
          userId: "users_123",
          reason: "Issue #3008 false positive",
        },
      }),
      expect.anything(),
    );
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
