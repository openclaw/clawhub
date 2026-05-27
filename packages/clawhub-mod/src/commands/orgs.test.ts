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

const { cmdCreateOrg, cmdRemoveOrgMember, cmdRepairScopedPackages } = await import("./orgs");

afterEach(() => {
  vi.clearAllMocks();
});

async function withCsv(content: string) {
  const dir = await mkdtemp(join(tmpdir(), "clawhub-mod-orgs-"));
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
        member: { userId: "users:vincent", handle: "vincentkoc", role: "owner" },
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
        target: {
          packageId: "packages:opik",
          name: "@opik/opik-openclaw",
          runtimeId: "opik-openclaw",
          ownerUserId: "users:vincent",
          ownerPublisherId: "publishers:vincent",
          channel: "community",
          softDeletedAt: null,
        },
        retiredName: null,
        operations: [{ action: "transfer-owner", packageId: "packages:opik", owner: "opik" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        dryRun: false,
        source: {
          packageId: "packages:opik",
          name: "@opik/opik-openclaw",
          runtimeId: "opik-openclaw",
          ownerUserId: "users:vincent",
          ownerPublisherId: "publishers:vincent",
          channel: "community",
          softDeletedAt: null,
        },
        target: {
          packageId: "packages:opik",
          name: "@opik/opik-openclaw",
          runtimeId: "opik-openclaw",
          ownerUserId: "users:vincent",
          ownerPublisherId: "publishers:vincent",
          channel: "community",
          softDeletedAt: null,
        },
        retiredName: null,
        operations: [{ action: "transfer-owner", packageId: "packages:opik", owner: "opik" }],
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
            handle: "opik",
            displayName: "Opik",
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
          path: "/api/v1/packages/%40opik%2Fopik-openclaw/repair-name",
          body: {
            nextName: "@opik/opik-openclaw",
            owner: "opik",
            reason: "Move legacy personal package into @opik",
            dryRun: true,
          },
        }),
        expect.anything(),
      );
      expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
        3,
        "https://clawhub.ai",
        expect.objectContaining({
          path: "/api/v1/packages/%40opik%2Fopik-openclaw/repair-name",
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
