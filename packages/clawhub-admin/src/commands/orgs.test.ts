/* @vitest-environment node */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  cmdAddOfficialOrg,
  cmdCreateOrg,
  cmdDeleteOrg,
  cmdListOfficialOrgs,
  cmdReclaimDeletedOrgHandle,
  cmdRemoveOfficialOrg,
  cmdRemoveOrgMember,
  cmdRepairScopedPackages,
} = await import("./orgs");

afterEach(() => {
  vi.clearAllMocks();
});

async function withCsv(content: string) {
  const dir = await mkdtemp(join(tmpdir(), "clawhub-admin-orgs-"));
  const path = join(dir, "repairs.csv");
  await writeFile(path, content, "utf8");
  return {
    path,
    async cleanup() {
      await rm(dir, { force: true, recursive: true });
    },
  };
}

describe("cmdCreateOrg", () => {
  it("creates an org publisher and adds the legacy owner as owner by default", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      publisherId: "publishers:opik",
      handle: "opik",
      created: true,
      migrated: false,
      trusted: false,
      member: {
        userId: "users:vincent",
        handle: "vincentkoc",
        role: "owner",
      },
    });

    await cmdCreateOrg(makeGlobalOpts(), "Opik", {
      displayName: "Opik",
      member: "vincentkoc",
    });

    expect(authTokenMocks.requireAuthToken).toHaveBeenCalled();
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/publisher",
        token: "tkn",
        body: {
          handle: "opik",
          displayName: "Opik",
          memberHandle: "vincentkoc",
          memberRole: "owner",
        },
      }),
      expect.anything(),
    );
  });

  it("only sends trusted when explicitly requested", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      publisherId: "publishers:opik",
      handle: "opik",
      created: true,
      migrated: false,
      trusted: true,
      member: {
        userId: "users:vincent",
        handle: "vincentkoc",
        role: "owner",
      },
    });

    await cmdCreateOrg(makeGlobalOpts(), "opik", { member: "vincentkoc", trusted: true });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        body: {
          handle: "opik",
          memberHandle: "vincentkoc",
          memberRole: "owner",
          trusted: true,
        },
      }),
      expect.anything(),
    );
  });

  it("creates org publishers with npm-compatible handles", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      publisherId: "publishers:example.tools",
      handle: "example.tools",
      created: true,
      migrated: false,
      trusted: false,
      member: {
        userId: "users:vincent",
        handle: "vincentkoc",
        role: "owner",
      },
    });

    await cmdCreateOrg(makeGlobalOpts(), "@Example.Tools", {
      displayName: "Example Tools",
      member: "vincentkoc",
      json: true,
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        body: expect.objectContaining({
          handle: "example.tools",
          displayName: "Example Tools",
          memberHandle: "vincentkoc",
        }),
      }),
      expect.anything(),
    );
  });

  it("requires a valid org member role", async () => {
    await expect(
      cmdCreateOrg(makeGlobalOpts(), "opik", {
        member: "vincentkoc",
        role: "moderator",
      }),
    ).rejects.toThrow(/--role must be owner, admin, or publisher/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("requires an explicit member so the moderator is not added as owner", async () => {
    await expect(cmdCreateOrg(makeGlobalOpts(), "opik", {})).rejects.toThrow(/--member required/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });
});

describe("cmdRemoveOrgMember", () => {
  it("removes a user from an org publisher by handle", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      publisherId: "publishers:opik",
      handle: "opik",
      removed: true,
      member: {
        userId: "users:patrick",
        handle: "patrick-erichsen-2",
        role: "owner",
      },
    });

    const result = await cmdRemoveOrgMember(makeGlobalOpts(), "Opik", "@patrick-erichsen-2", {
      json: true,
    });

    expect(result).toMatchObject({ ok: true, handle: "opik", removed: true });
    expect(authTokenMocks.requireAuthToken).toHaveBeenCalled();
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/publisher-member",
        token: "tkn",
        body: {
          handle: "opik",
          memberHandle: "patrick-erichsen-2",
        },
      }),
      expect.anything(),
    );
  });

  it("requires an explicit member handle", async () => {
    await expect(cmdRemoveOrgMember(makeGlobalOpts(), "opik", "  ")).rejects.toThrow(
      /Member handle required/i,
    );
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });
});

describe("cmdDeleteOrg", () => {
  it("plans deletion of an empty org publisher by default", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      publisherId: "publishers:clawhub",
      handle: "clawhub",
      dryRun: true,
      deleted: false,
      activeSkills: 0,
      activePackages: 0,
      memberCount: 1,
    });

    const result = await cmdDeleteOrg(makeGlobalOpts(), "ClawHub", {
      reason: "Reserved platform handle",
      json: true,
    });

    expect(result).toMatchObject({ ok: true, dryRun: true, deleted: false });
    expect(authTokenMocks.requireAuthToken).toHaveBeenCalled();
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/publisher-delete",
        token: "tkn",
        body: {
          handle: "clawhub",
          reason: "Reserved platform handle",
          dryRun: true,
        },
      }),
      expect.anything(),
    );
  });

  it("applies deletion only when --apply is passed", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      publisherId: "publishers:clawhub",
      handle: "clawhub",
      dryRun: false,
      deleted: true,
      activeSkills: 0,
      activePackages: 0,
      memberCount: 1,
    });

    await cmdDeleteOrg(makeGlobalOpts(), "clawhub", {
      reason: "Reserved platform handle",
      apply: true,
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        body: expect.objectContaining({
          handle: "clawhub",
          dryRun: false,
        }),
        retryCount: 0,
      }),
      expect.anything(),
    );
  });

  it("requires an audit reason", async () => {
    await expect(cmdDeleteOrg(makeGlobalOpts(), "clawhub", {})).rejects.toThrow(
      /--reason required/i,
    );
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });
});

describe("cmdReclaimDeletedOrgHandle", () => {
  it("dry-runs deleted org handle reclaim by default", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      publisherId: "publishers:tencent",
      handle: "tencent",
      dryRun: true,
      hardDeleted: false,
      activeSkills: 0,
      activePackages: 0,
      memberCount: 1,
      githubSources: 0,
      githubSourceContents: 0,
      officialPublisher: false,
      confirmationToken: "reclaim-deleted-org:tencent",
    });

    const result = await cmdReclaimDeletedOrgHandle(makeGlobalOpts(), "@Tencent", {
      reason: "Free spam org handle",
      json: true,
    });

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      hardDeleted: false,
      confirmationToken: "reclaim-deleted-org:tencent",
    });
    expect(authTokenMocks.requireAuthToken).toHaveBeenCalled();
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/publisher-reclaim",
        token: "tkn",
        body: {
          handle: "tencent",
          reason: "Free spam org handle",
          dryRun: true,
        },
      }),
      expect.anything(),
    );
  });

  it("applies reclaim only with an explicit confirmation token", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      publisherId: "publishers:tencent",
      handle: "tencent",
      dryRun: false,
      hardDeleted: true,
      activeSkills: 0,
      activePackages: 0,
      memberCount: 1,
      githubSources: 0,
      githubSourceContents: 0,
      officialPublisher: false,
      confirmationToken: "reclaim-deleted-org:tencent",
    });

    await cmdReclaimDeletedOrgHandle(makeGlobalOpts(), "tencent", {
      reason: "Free spam org handle",
      apply: true,
      confirm: "reclaim-deleted-org:tencent",
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        body: expect.objectContaining({
          handle: "tencent",
          dryRun: false,
          confirmationToken: "reclaim-deleted-org:tencent",
        }),
        retryCount: 0,
      }),
      expect.anything(),
    );
  });

  it("requires a confirmation token when applying reclaim", async () => {
    await expect(
      cmdReclaimDeletedOrgHandle(makeGlobalOpts(), "tencent", {
        reason: "Free spam org handle",
        apply: true,
      }),
    ).rejects.toThrow(/--confirm required/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });
});

describe("official publisher commands", () => {
  it("lists official publishers", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      items: [
        {
          officialPublisherId: "officialPublishers:1",
          publisherId: "publishers:openclaw",
          handle: "openclaw",
          displayName: "OpenClaw",
          kind: "org",
          active: true,
          reason: "platform-owned publisher",
          createdByUserId: "users:admin",
          createdByHandle: "patrick-erichsen-2",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    const result = await cmdListOfficialOrgs(makeGlobalOpts(), { json: true });

    expect(result.items).toHaveLength(1);
    expect(authTokenMocks.requireAuthToken).toHaveBeenCalled();
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/users/publisher-official",
        token: "tkn",
      }),
      expect.anything(),
    );
  });

  it("prints official personal publishers", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      items: [
        {
          officialPublisherId: "officialPublishers:steipete",
          publisherId: "publishers:steipete",
          handle: "steipete",
          displayName: "Peter Steinberger",
          kind: "user",
          active: true,
          reason: "Verified individual publisher",
          createdByUserId: "users:admin",
          createdByHandle: "patrick-erichsen-2",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    await cmdListOfficialOrgs(makeGlobalOpts());

    expect(log).toHaveBeenCalledWith(
      "@steipete  Peter Steinberger - Verified individual publisher",
    );
    log.mockRestore();
  });

  it("requires --yes to add an official publisher when input is disabled", async () => {
    await expect(
      cmdAddOfficialOrg(
        makeGlobalOpts(),
        "nvidia",
        { reason: "NVIDIA source-backed catalog" },
        false,
      ),
    ).rejects.toThrow(/--yes/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("marks a publisher official", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      publisherId: "publishers:nvidia",
      handle: "nvidia",
      added: true,
      officialPublisherId: "officialPublishers:nvidia",
    });

    const result = await cmdAddOfficialOrg(
      makeGlobalOpts(),
      "@NVIDIA",
      { reason: "NVIDIA source-backed catalog", yes: true, json: true },
      false,
    );

    expect(result).toMatchObject({ ok: true, handle: "nvidia", added: true });
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/publisher-official",
        token: "tkn",
        body: {
          action: "add",
          handle: "nvidia",
          reason: "NVIDIA source-backed catalog",
        },
      }),
      expect.anything(),
    );
  });

  it("removes an org publisher from the official list", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      publisherId: "publishers:nvidia",
      handle: "nvidia",
      removed: true,
      officialPublisherId: "officialPublishers:nvidia",
    });

    const result = await cmdRemoveOfficialOrg(
      makeGlobalOpts(),
      "nvidia",
      { reason: "requested by publisher", yes: true, json: true },
      false,
    );

    expect(result).toMatchObject({ ok: true, handle: "nvidia", removed: true });
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/users/publisher-official",
        token: "tkn",
        body: {
          action: "remove",
          handle: "nvidia",
          reason: "requested by publisher",
        },
      }),
      expect.anything(),
    );
  });
});

describe("cmdRepairScopedPackages", () => {
  it("plans scoped package repairs from CSV without touching the API by default", async () => {
    const csv = await withCsv(
      [
        "packageName,intendedOrg,legacyOwner,orgDisplayName",
        "@opik/opik-openclaw,opik,vincentkoc,Opik",
      ].join("\n"),
    );
    try {
      const result = await cmdRepairScopedPackages(makeGlobalOpts(), csv.path, { json: true });

      expect(result).toMatchObject({
        ok: true,
        dryRun: true,
        total: 1,
        planned: 1,
        applied: 0,
        failed: 0,
      });
      expect(httpMocks.apiRequest).not.toHaveBeenCalled();
      expect(authTokenMocks.requireAuthToken).not.toHaveBeenCalled();
    } finally {
      await csv.cleanup();
    }
  });

  it("applies each row by ensuring the org owner then guarded transfer", async () => {
    const csv = await withCsv(
      [
        "packageName,intendedOrg,legacyOwner,orgDisplayName",
        "@example.tools/demo-plugin,example.tools,vincentkoc,Example Tools",
      ].join("\n"),
    );
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        ok: true,
        publisherId: "publishers:example.tools",
        handle: "example.tools",
        created: false,
        migrated: false,
        trusted: false,
        member: { userId: "users:vincent", handle: "vincentkoc", role: "owner" },
      })
      .mockResolvedValueOnce({
        ok: true,
        dryRun: true,
        source: {
          packageId: "packages:example-tools",
          name: "@example.tools/demo-plugin",
          runtimeId: "demo-plugin",
          ownerUserId: "users:vincent",
          ownerPublisherId: "publishers:vincent",
          channel: "community",
          softDeletedAt: null,
        },
        target: {
          packageId: "packages:example-tools",
          name: "@example.tools/demo-plugin",
          runtimeId: "demo-plugin",
          ownerUserId: "users:vincent",
          ownerPublisherId: "publishers:vincent",
          channel: "community",
          softDeletedAt: null,
        },
        retiredName: null,
        operations: [
          { action: "transfer-owner", packageId: "packages:example-tools", owner: "example.tools" },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        dryRun: false,
        source: {
          packageId: "packages:example-tools",
          name: "@example.tools/demo-plugin",
          runtimeId: "demo-plugin",
          ownerUserId: "users:vincent",
          ownerPublisherId: "publishers:vincent",
          channel: "community",
          softDeletedAt: null,
        },
        target: {
          packageId: "packages:example-tools",
          name: "@example.tools/demo-plugin",
          runtimeId: "demo-plugin",
          ownerUserId: "users:vincent",
          ownerPublisherId: "publishers:vincent",
          channel: "community",
          softDeletedAt: null,
        },
        retiredName: null,
        operations: [
          { action: "transfer-owner", packageId: "packages:example-tools", owner: "example.tools" },
        ],
      });

    try {
      const result = await cmdRepairScopedPackages(makeGlobalOpts(), csv.path, {
        apply: true,
        json: true,
      });

      expect(result).toMatchObject({ ok: true, dryRun: false, applied: 1, failed: 0 });
      expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
        1,
        "https://clawhub.ai",
        expect.objectContaining({
          method: "POST",
          path: "/api/v1/users/publisher",
          body: {
            handle: "example.tools",
            displayName: "Example Tools",
            memberHandle: "vincentkoc",
            memberRole: "owner",
          },
        }),
        expect.anything(),
      );
      expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
        2,
        "https://clawhub.ai",
        expect.objectContaining({
          path: "/api/v1/packages/%40example.tools%2Fdemo-plugin/repair-name",
          body: {
            nextName: "@example.tools/demo-plugin",
            owner: "example.tools",
            reason: "Move legacy personal package into @example.tools",
            dryRun: true,
          },
        }),
        expect.anything(),
      );
      expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
        3,
        "https://clawhub.ai",
        expect.objectContaining({
          path: "/api/v1/packages/%40example.tools%2Fdemo-plugin/repair-name",
          body: expect.objectContaining({ dryRun: false }),
        }),
        expect.anything(),
      );
    } finally {
      await csv.cleanup();
    }
  });

  it("refuses to apply when transfer dry-run plans anything other than owner transfer", async () => {
    const csv = await withCsv(
      [
        "packageName,intendedOrg,legacyOwner,orgDisplayName",
        "@opik/opik-openclaw,opik,vincentkoc,Opik",
      ].join("\n"),
    );
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        ok: true,
        publisherId: "publishers:opik",
        handle: "opik",
        created: false,
        migrated: false,
        trusted: false,
      })
      .mockResolvedValueOnce({
        ok: true,
        dryRun: true,
        source: {
          packageId: "packages:opik",
          name: "@opik/opik-openclaw",
          runtimeId: "opik-openclaw",
          ownerUserId: "users:vincent",
          ownerPublisherId: "publishers:vincent",
          channel: "community",
          softDeletedAt: null,
        },
        target: null,
        retiredName: null,
        operations: [{ action: "rename-source", from: "old", to: "new" }],
      });

    try {
      const result = await cmdRepairScopedPackages(makeGlobalOpts(), csv.path, {
        apply: true,
        json: true,
      });

      expect(result).toMatchObject({ ok: false, dryRun: false, applied: 0, failed: 1 });
      expect(httpMocks.apiRequest).toHaveBeenCalledTimes(2);
    } finally {
      await csv.cleanup();
    }
  });
});
