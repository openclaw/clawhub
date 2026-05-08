/* @vitest-environment node */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthTokenModuleMocks,
  createHttpModuleMocks,
  createRegistryModuleMocks,
  createUiModuleMocks,
  makeGlobalOpts,
} from "../../../test/cliCommandTestKit.js";

const authTokenMocks = createAuthTokenModuleMocks();
const registryMocks = createRegistryModuleMocks();
const httpMocks = createHttpModuleMocks();
const uiMocks = createUiModuleMocks();
const originalOidcRequestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
const originalOidcRequestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

vi.mock("../../http.js", () => httpMocks.moduleFactory());
vi.mock("../registry.js", () => registryMocks.moduleFactory());
vi.mock("../authToken.js", () => authTokenMocks.moduleFactory());
vi.mock("../ui.js", () => uiMocks.moduleFactory());

const {
  cmdDeletePackage,
  cmdAppealPackage,
  cmdDownloadPackage,
  cmdExplorePackages,
  cmdGetPackageTrustedPublisher,
  cmdInspectPackage,
  cmdPackageModerationStatus,
  cmdPackageMigrationStatus,
  cmdPackageReadiness,
  cmdPackPackage,
  cmdPublishPackage,
  cmdReportPackage,
  cmdVerifyPackage,
} = await import("./packages");
const {
  cmdBackfillPackageArtifacts,
  cmdDeletePackageTrustedPublisher,
  cmdListPackageAppeals,
  cmdListPackageMigrations,
  cmdListPackageReports,
  cmdModeratePackageRelease,
  cmdPackageModerationQueue,
  cmdResolvePackageAppeal,
  cmdSetPackageTrustedPublisher,
  cmdTriagePackageReport,
  cmdUpsertPackageMigration,
} = await import("../../../../clawhub-mod/src/commands/packages");
const { parseClawPack } = await import("../../clawpack");

const mockLog = vi.spyOn(console, "log").mockImplementation(() => {});
const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

function makeOpts(workdir = "/work") {
  return makeGlobalOpts(workdir);
}

async function makeTmpWorkdir() {
  return await mkdtemp(join(tmpdir(), "clawhub-package-"));
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function getPublishForm() {
  const publishCall = httpMocks.apiRequestForm.mock.calls.find((call) => {
    const req = call[1] as { path?: string } | undefined;
    return req?.path === "/api/v1/packages";
  });
  if (!publishCall) throw new Error("Missing publish call");
  const form = (publishCall[1] as { form?: FormData }).form;
  if (!(form instanceof FormData)) throw new Error("Missing publish form");
  return form;
}

function getPublishPayload() {
  const form = getPublishForm();
  const payloadEntry = form.get("payload");
  if (typeof payloadEntry !== "string") throw new Error("Missing publish payload");
  return JSON.parse(payloadEntry) as Record<string, unknown>;
}

function getUploadedFileNames() {
  const form = getPublishForm();
  return (form.getAll("files") as Array<Blob & { name?: string }>)
    .map((file) => file.name ?? "")
    .sort();
}

function getUploadedClawPackNames() {
  const form = getPublishForm();
  return (form.getAll("clawpack") as Array<Blob & { name?: string }>)
    .map((file) => file.name ?? "")
    .sort();
}

function getUploadedClawPacks() {
  const form = getPublishForm();
  return form.getAll("clawpack") as Array<Blob & { name?: string }>;
}

function makeCodePluginPackageJson(overrides: Record<string, unknown>) {
  return JSON.stringify({
    openclaw: {
      extensions: ["./dist/index.js"],
      hostTargets: ["darwin-arm64", "linux-x64", "win32-x64"],
      environment: {},
      compat: {
        pluginApi: ">=2026.3.24-beta.2",
      },
      build: {
        openclawVersion: "2026.3.24-beta.2",
      },
    },
    ...overrides,
  });
}

const TAR_BLOCK_SIZE = 512;

function writeTarString(target: Uint8Array, offset: number, width: number, value: string) {
  const encoded = new TextEncoder().encode(value);
  target.set(encoded.subarray(0, width), offset);
}

function tarOctal(value: number, width: number) {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

function tarFile(path: string, content: string) {
  const bytes = new TextEncoder().encode(content);
  const header = new Uint8Array(TAR_BLOCK_SIZE);
  writeTarString(header, 0, 100, path);
  writeTarString(header, 100, 8, tarOctal(0o644, 8));
  writeTarString(header, 108, 8, tarOctal(0, 8));
  writeTarString(header, 116, 8, tarOctal(0, 8));
  writeTarString(header, 124, 12, tarOctal(bytes.byteLength, 12));
  writeTarString(header, 136, 12, tarOctal(0, 12));
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeTarString(header, 257, 6, "ustar");
  writeTarString(header, 263, 2, "00");

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeTarString(header, 148, 8, tarOctal(checksum, 8));

  const paddedSize = Math.ceil(bytes.byteLength / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
  const body = new Uint8Array(paddedSize);
  body.set(bytes);
  return [header, body];
}

function npmPackFixture(files: Record<string, string>) {
  const parts: Uint8Array[] = [];
  for (const [path, content] of Object.entries(files)) {
    parts.push(...tarFile(path, content));
  }
  parts.push(new Uint8Array(TAR_BLOCK_SIZE), new Uint8Array(TAR_BLOCK_SIZE));
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const tar = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    tar.set(part, offset);
    offset += part.byteLength;
  }
  return gzipSync(tar);
}

function artifactIdentity(bytes: Uint8Array) {
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    npmIntegrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    npmShasum: createHash("sha1").update(bytes).digest("hex"),
  };
}

afterEach(() => {
  vi.clearAllMocks();
  mockLog.mockClear();
  mockWrite.mockClear();
  uiMocks.spinner.text = "";
  vi.unstubAllGlobals();
  if (originalOidcRequestUrl === undefined) {
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  } else {
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = originalOidcRequestUrl;
  }
  if (originalOidcRequestToken === undefined) {
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  } else {
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = originalOidcRequestToken;
  }
});

describe("package commands", () => {
  it("searches package catalog via /api/v1/packages/search", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      results: [
        {
          score: 10,
          package: {
            name: "@scope/demo",
            displayName: "Demo",
            family: "code-plugin",
            channel: "community",
            isOfficial: false,
            summary: "Demo plugin",
            latestVersion: "1.2.3",
          },
        },
      ],
    });

    await cmdExplorePackages(makeOpts(), "demo plugin", {
      family: "code-plugin",
      executesCode: true,
      os: "darwin",
      requiresBrowser: true,
      externalService: "GitHub",
      artifactKind: "npm-pack",
      npmMirror: true,
    });

    const request = httpMocks.apiRequest.mock.calls[0]?.[1] as { url?: string } | undefined;
    const url = new URL(String(request?.url));
    expect(url.pathname).toBe("/api/v1/packages/search");
    expect(url.searchParams.get("q")).toBe("demo plugin");
    expect(url.searchParams.get("family")).toBe("code-plugin");
    expect(url.searchParams.get("executesCode")).toBe("true");
    expect(url.searchParams.get("os")).toBe("darwin");
    expect(url.searchParams.get("requiresBrowser")).toBe("true");
    expect(url.searchParams.get("externalService")).toBe("GitHub");
    expect(url.searchParams.get("artifactKind")).toBe("npm-pack");
    expect(url.searchParams.get("npmMirror")).toBe("true");
  });

  it("supports skill family package browse requests", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    });

    await cmdExplorePackages(makeOpts(), "", { family: "skill", target: "linux-x64", limit: 7 });

    const request = httpMocks.apiRequest.mock.calls[0]?.[1] as { url?: string } | undefined;
    const url = new URL(String(request?.url));
    expect(url.pathname).toBe("/api/v1/packages");
    expect(url.searchParams.get("family")).toBe("skill");
    expect(url.searchParams.get("target")).toBe("linux-x64");
    expect(url.searchParams.get("limit")).toBe("7");
  });

  it("uses tag param when fetching a package file", async () => {
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        package: {
          name: "demo",
          displayName: "Demo",
          family: "code-plugin",
          runtimeId: "demo.plugin",
          channel: "community",
          isOfficial: false,
          summary: null,
          latestVersion: "2.0.0",
          createdAt: 1,
          updatedAt: 2,
          tags: { latest: "2.0.0" },
          compatibility: null,
          capabilities: { executesCode: true },
          verification: {
            tier: "structural",
            scope: "artifact-only",
          },
        },
        owner: null,
      })
      .mockResolvedValueOnce({
        package: { name: "demo", displayName: "Demo", family: "code-plugin" },
        version: {
          version: "2.0.0",
          createdAt: 3,
          changelog: "init",
          files: [],
        },
      });
    httpMocks.fetchText.mockResolvedValue("content");

    await cmdInspectPackage(makeOpts(), "demo", { file: "README.md", tag: "latest" });

    const fetchArgs = httpMocks.fetchText.mock.calls[0]?.[1] as { url?: string } | undefined;
    const url = new URL(String(fetchArgs?.url));
    expect(url.pathname).toBe("/api/v1/packages/demo/file");
    expect(url.searchParams.get("path")).toBe("README.md");
    expect(url.searchParams.get("tag")).toBe("latest");
    expect(url.searchParams.get("version")).toBeNull();
  });

  it("downloads a ClawPack artifact through the explicit artifact resolver", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const bytes = npmPackFixture({
        "package/package.json": JSON.stringify({
          name: "@scope/demo",
          version: "1.2.3",
        }),
        "package/openclaw.plugin.json": JSON.stringify({ id: "demo.plugin" }),
      });
      const identity = artifactIdentity(bytes);
      await mkdir(join(workdir, "downloads"), { recursive: true });
      httpMocks.apiRequest
        .mockResolvedValueOnce({
          package: {
            name: "@scope/demo",
            displayName: "Demo",
            family: "code-plugin",
            runtimeId: "demo.plugin",
            channel: "community",
            isOfficial: false,
            summary: null,
            latestVersion: "1.2.3",
            createdAt: 1,
            updatedAt: 2,
            tags: { latest: "1.2.3" },
          },
          owner: null,
        })
        .mockResolvedValueOnce({
          package: {
            name: "@scope/demo",
            displayName: "Demo",
            family: "code-plugin",
          },
          version: "1.2.3",
          artifact: {
            kind: "npm-pack",
            sha256: identity.sha256,
            size: bytes.byteLength,
            format: "tgz",
            npmIntegrity: identity.npmIntegrity,
            npmShasum: identity.npmShasum,
            npmTarballName: "demo-1.2.3.tgz",
            downloadUrl: "https://clawhub.ai/api/npm/@scope/demo/-/demo-1.2.3.tgz",
            tarballUrl: "https://clawhub.ai/api/npm/@scope/demo/-/demo-1.2.3.tgz",
            legacyDownloadUrl:
              "https://clawhub.ai/api/v1/packages/@scope/demo/download?version=1.2.3",
          },
        });
      httpMocks.fetchBinary.mockResolvedValue(bytes);

      await cmdDownloadPackage(makeOpts(workdir), "@scope/demo", {
        tag: "latest",
        output: "downloads",
      });

      expect(httpMocks.apiRequest.mock.calls[1]?.[1]).toMatchObject({
        method: "GET",
        path: "/api/v1/packages/%40scope%2Fdemo/versions/1.2.3/artifact",
      });
      expect(httpMocks.fetchBinary).toHaveBeenCalledWith("https://clawhub.ai", {
        url: "https://clawhub.ai/api/npm/@scope/demo/-/demo-1.2.3.tgz",
        token: undefined,
      });
      expect(await readFile(join(workdir, "downloads", "demo-1.2.3.tgz"))).toEqual(
        Buffer.from(bytes),
      );
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining("Downloaded @scope/demo@1.2.3"));
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("downloads legacy ZIP artifacts without enforcing stale stored release digests", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const bytes = new TextEncoder().encode("rebuilt legacy zip");
      await mkdir(join(workdir, "downloads"), { recursive: true });
      httpMocks.apiRequest
        .mockResolvedValueOnce({
          package: {
            name: "@scope/demo",
            displayName: "Demo",
            family: "code-plugin",
            runtimeId: "demo.plugin",
            channel: "community",
            isOfficial: false,
            summary: null,
            latestVersion: "1.2.3",
            createdAt: 1,
            updatedAt: 2,
            tags: { latest: "1.2.3" },
          },
          owner: null,
        })
        .mockResolvedValueOnce({
          package: {
            name: "@scope/demo",
            displayName: "Demo",
            family: "code-plugin",
          },
          version: "1.2.3",
          artifact: {
            kind: "legacy-zip",
            sha256: "0".repeat(64),
            format: "zip",
            downloadUrl: "https://clawhub.ai/api/v1/packages/@scope/demo/download?version=1.2.3",
            legacyDownloadUrl:
              "https://clawhub.ai/api/v1/packages/@scope/demo/download?version=1.2.3",
          },
        });
      httpMocks.fetchBinary.mockResolvedValue(bytes);

      await cmdDownloadPackage(makeOpts(workdir), "@scope/demo", {
        tag: "latest",
        output: "downloads",
      });

      expect(await readFile(join(workdir, "downloads", "scope-demo-1.2.3.zip"))).toEqual(
        Buffer.from(bytes),
      );
      expect(uiMocks.spinner.fail).not.toHaveBeenCalled();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("verifies a local ClawPack against resolved artifact metadata", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const bytes = npmPackFixture({
        "package/package.json": JSON.stringify({
          name: "@scope/demo",
          version: "1.2.3",
        }),
        "package/openclaw.plugin.json": JSON.stringify({ id: "demo.plugin" }),
      });
      const identity = artifactIdentity(bytes);
      await writeFile(join(workdir, "demo-1.2.3.tgz"), bytes);
      httpMocks.apiRequest
        .mockResolvedValueOnce({
          package: {
            name: "@scope/demo",
            displayName: "Demo",
            family: "code-plugin",
            runtimeId: "demo.plugin",
            channel: "community",
            isOfficial: false,
            summary: null,
            latestVersion: "1.2.3",
            createdAt: 1,
            updatedAt: 2,
            tags: { latest: "1.2.3" },
          },
          owner: null,
        })
        .mockResolvedValueOnce({
          package: {
            name: "@scope/demo",
            displayName: "Demo",
            family: "code-plugin",
          },
          version: "1.2.3",
          artifact: {
            kind: "npm-pack",
            sha256: identity.sha256,
            format: "tgz",
            npmIntegrity: identity.npmIntegrity,
            npmShasum: identity.npmShasum,
            npmTarballName: "demo-1.2.3.tgz",
            downloadUrl: "https://clawhub.ai/api/npm/@scope/demo/-/demo-1.2.3.tgz",
          },
        });

      await cmdVerifyPackage(makeOpts(workdir), "demo-1.2.3.tgz", {
        packageName: "@scope/demo",
        tag: "latest",
      });

      expect(mockLog).toHaveBeenCalledWith("OK. Artifact verification passed.");
      expect(uiMocks.spinner.fail).not.toHaveBeenCalled();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("fails package artifact verification on digest mismatch", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const bytes = npmPackFixture({
        "package/package.json": JSON.stringify({
          name: "@scope/demo",
          version: "1.2.3",
        }),
      });
      await writeFile(join(workdir, "demo-1.2.3.tgz"), bytes);

      await expect(
        cmdVerifyPackage(makeOpts(workdir), "demo-1.2.3.tgz", {
          sha256: "bad",
        }),
      ).rejects.toThrow("SHA-256 mismatch");
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("sets package release moderation state", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      packageId: "pkg_1",
      releaseId: "rel_1",
      state: "quarantined",
      scanStatus: "malicious",
    });

    await cmdModeratePackageRelease(makeOpts(), "@scope/demo", {
      version: "1.2.3",
      state: "quarantined",
      reason: "suspicious native payload",
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      {
        method: "POST",
        path: "/api/v1/packages/%40scope%2Fdemo/versions/1.2.3/moderation",
        token: "tkn",
        body: {
          state: "quarantined",
          reason: "suspicious native payload",
        },
      },
      expect.anything(),
    );
    expect(mockLog).toHaveBeenCalledWith(
      "OK. @scope/demo@1.2.3 moderation state set to quarantined.",
    );
  });

  it("reports packages for moderator review", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      reported: true,
      alreadyReported: false,
      packageId: "pkg_1",
      releaseId: "rel_1",
      reportCount: 1,
    });

    await cmdReportPackage(makeOpts(), "@scope/demo", {
      version: "1.2.3",
      reason: "suspicious native payload",
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      {
        method: "POST",
        path: "/api/v1/packages/%40scope%2Fdemo/report",
        token: "tkn",
        body: {
          reason: "suspicious native payload",
          version: "1.2.3",
        },
      },
      expect.anything(),
    );
    expect(mockLog).toHaveBeenCalledWith("OK. Reported @scope/demo@1.2.3 for moderator review.");
  });

  it("submits package appeals", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      submitted: true,
      alreadyOpen: false,
      appealId: "packageAppeals:1",
      packageId: "pkg_1",
      releaseId: "rel_1",
      status: "open",
    });

    await cmdAppealPackage(makeOpts(), "@scope/demo", {
      version: "1.2.3",
      message: "please review",
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      {
        method: "POST",
        path: "/api/v1/packages/%40scope%2Fdemo/appeal",
        token: "tkn",
        body: {
          version: "1.2.3",
          message: "please review",
        },
      },
      expect.anything(),
    );
    expect(mockLog).toHaveBeenCalledWith("OK. Appeal submitted: packageAppeals:1");
  });

  it("lists package appeals", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      items: [
        {
          appealId: "packageAppeals:1",
          packageId: "pkg_1",
          releaseId: "rel_1",
          name: "@scope/demo",
          displayName: "Demo",
          family: "code-plugin",
          version: "1.2.3",
          message: "please review",
          status: "open",
          createdAt: 1,
          submitter: { userId: "users:owner", handle: "owner", displayName: "Owner" },
          resolvedAt: null,
          resolvedBy: null,
          resolutionNote: null,
        },
      ],
      nextCursor: null,
      done: true,
    });

    await cmdListPackageAppeals(makeOpts(), { status: "open", limit: 10 });

    const request = httpMocks.apiRequest.mock.calls[0]?.[1] as { url?: string } | undefined;
    const url = new URL(String(request?.url));
    expect(url.pathname).toBe("/api/v1/packages/appeals");
    expect(url.searchParams.get("status")).toBe("open");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(mockLog).toHaveBeenCalledWith("packageAppeals:1 open @scope/demo@1.2.3");
  });

  it("resolves package appeals", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      appealId: "packageAppeals:1",
      packageId: "pkg_1",
      releaseId: "rel_1",
      status: "accepted",
      actionTaken: "approve",
    });

    await cmdResolvePackageAppeal(makeOpts(), "packageAppeals:1", {
      status: "accepted",
      note: "scanner finding cleared",
      action: "approve",
      yes: true,
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      {
        method: "POST",
        path: "/api/v1/packages/appeals/packageAppeals%3A1/resolve",
        token: "tkn",
        body: {
          status: "accepted",
          note: "scanner finding cleared",
          finalAction: "approve",
        },
      },
      expect.anything(),
    );
    expect(mockLog).toHaveBeenCalledWith(
      "OK. Appeal packageAppeals:1 set to accepted; action approve.",
    );
    expect(mockLog).toHaveBeenCalledWith("  - Approve the package release.");
  });

  it("lists package reports", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      items: [
        {
          reportId: "packageReports:1",
          packageId: "pkg_1",
          releaseId: "rel_1",
          name: "@scope/demo",
          displayName: "Demo",
          family: "code-plugin",
          version: "1.2.3",
          reason: "suspicious",
          status: "open",
          createdAt: 1,
          reporter: { userId: "users:reporter", handle: "reporter", displayName: "Reporter" },
          triagedAt: null,
          triagedBy: null,
          triageNote: null,
        },
      ],
      nextCursor: null,
      done: true,
    });

    await cmdListPackageReports(makeOpts(), { status: "open", limit: 10 });

    const request = httpMocks.apiRequest.mock.calls[0]?.[1] as { url?: string } | undefined;
    const url = new URL(String(request?.url));
    expect(url.pathname).toBe("/api/v1/packages/reports");
    expect(url.searchParams.get("status")).toBe("open");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(mockLog).toHaveBeenCalledWith("packageReports:1 open @scope/demo@1.2.3");
  });

  it("triages package reports", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      reportId: "packageReports:1",
      packageId: "pkg_1",
      status: "confirmed",
      reportCount: 0,
      actionTaken: "quarantine",
    });

    await cmdTriagePackageReport(makeOpts(), "packageReports:1", {
      status: "confirmed",
      note: "handled",
      action: "quarantine",
      yes: true,
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      {
        method: "POST",
        path: "/api/v1/packages/reports/packageReports%3A1/triage",
        token: "tkn",
        body: {
          status: "confirmed",
          note: "handled",
          finalAction: "quarantine",
        },
      },
      expect.anything(),
    );
    expect(mockLog).toHaveBeenCalledWith(
      "OK. Report packageReports:1 set to confirmed; action quarantine.",
    );
    expect(mockLog).toHaveBeenCalledWith("  - Quarantine the package release.");
  });

  it("shows package moderation status", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      package: {
        packageId: "pkg_1",
        name: "@scope/demo",
        displayName: "Demo",
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        reportCount: 2,
        lastReportedAt: 456,
        scanStatus: "malicious",
      },
      latestRelease: {
        releaseId: "rel_1",
        version: "1.2.3",
        artifactKind: "npm-pack",
        scanStatus: "malicious",
        moderationState: "quarantined",
        moderationReason: "manual review",
        blockedFromDownload: true,
        reasons: ["manual:quarantined", "scan:malicious", "reports:2"],
        createdAt: 123,
      },
    });

    await cmdPackageModerationStatus(makeOpts(), "@scope/demo");

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      {
        method: "GET",
        path: "/api/v1/packages/%40scope%2Fdemo/moderation",
        token: "tkn",
      },
      expect.anything(),
    );
    expect(mockLog).toHaveBeenCalledWith("@scope/demo moderation");
    expect(mockLog).toHaveBeenCalledWith("  blocked: yes");
  });

  it("lists the package moderation queue", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      items: [
        {
          packageId: "pkg_1",
          releaseId: "rel_1",
          name: "@scope/demo",
          displayName: "Demo",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          version: "1.2.3",
          createdAt: 1,
          artifactKind: "npm-pack",
          scanStatus: "malicious",
          moderationState: "quarantined",
          moderationReason: "manual review",
          sourceRepo: "openclaw/demo",
          sourceCommit: "abc123",
          reportCount: 0,
          lastReportedAt: null,
          reasons: ["manual:quarantined", "scan:malicious"],
        },
      ],
      nextCursor: "cursor-1",
      done: false,
    });

    await cmdPackageModerationQueue(makeOpts(), { status: "blocked", limit: 10 });

    const request = httpMocks.apiRequest.mock.calls[0]?.[1] as { url?: string } | undefined;
    const url = new URL(String(request?.url));
    expect(url.pathname).toBe("/api/v1/packages/moderation/queue");
    expect(url.searchParams.get("status")).toBe("blocked");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(httpMocks.apiRequest.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      token: "tkn",
    });
    expect(mockLog).toHaveBeenCalledWith(
      "@scope/demo@1.2.3 malicious quarantined [manual:quarantined, scan:malicious]",
    );
    expect(mockLog).toHaveBeenCalledWith("Next cursor: cursor-1");
  });

  it("dry-runs package artifact metadata backfill by default", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      scanned: 20,
      updated: 3,
      nextCursor: "cursor-1",
      done: false,
      dryRun: true,
    });

    await cmdBackfillPackageArtifacts(makeOpts(), { batchSize: 20 });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      {
        method: "POST",
        path: "/api/v1/packages/backfill/artifacts",
        token: "tkn",
        body: {
          cursor: null,
          batchSize: 20,
          dryRun: true,
        },
      },
      expect.anything(),
    );
    expect(mockLog).toHaveBeenCalledWith(
      "Dry run package artifact backfill: scanned 20, would update 3.",
    );
    expect(mockLog).toHaveBeenCalledWith("Next cursor: cursor-1");
  });

  it("can apply package artifact backfill across all pages", async () => {
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        ok: true,
        scanned: 100,
        updated: 8,
        nextCursor: "cursor-2",
        done: false,
        dryRun: false,
      })
      .mockResolvedValueOnce({
        ok: true,
        scanned: 5,
        updated: 1,
        nextCursor: null,
        done: true,
        dryRun: false,
      });

    await cmdBackfillPackageArtifacts(makeOpts(), { apply: true, all: true, batchSize: 100 });

    expect(httpMocks.apiRequest).toHaveBeenCalledTimes(2);
    expect(httpMocks.apiRequest.mock.calls[0]?.[1]).toMatchObject({
      body: { cursor: null, batchSize: 100, dryRun: false },
    });
    expect(httpMocks.apiRequest.mock.calls[1]?.[1]).toMatchObject({
      body: { cursor: "cursor-2", batchSize: 100, dryRun: false },
    });
    expect(mockLog).toHaveBeenCalledWith(
      "Applied package artifact backfill: scanned 105, updated 9.",
    );
  });

  it("prints package readiness checks", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      package: {
        name: "@scope/demo",
        displayName: "Demo",
        family: "code-plugin",
        isOfficial: true,
        latestVersion: "1.2.3",
      },
      ready: false,
      checks: [
        {
          id: "clawpack",
          label: "ClawPack artifact",
          status: "fail",
          message: "Latest version is legacy ZIP-only.",
        },
      ],
      blockers: ["clawpack"],
    });

    await cmdPackageReadiness(makeOpts(), "@scope/demo");

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      {
        method: "GET",
        path: "/api/v1/packages/%40scope%2Fdemo/readiness",
        token: undefined,
      },
      expect.anything(),
    );
    expect(mockLog).toHaveBeenCalledWith("@scope/demo readiness: blocked");
    expect(mockLog).toHaveBeenCalledWith("FAIL clawpack: Latest version is legacy ZIP-only.");
    expect(mockLog).toHaveBeenCalledWith("Blockers: clawpack");
  });

  it("prints package migration status checks", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      package: {
        name: "@scope/demo",
        displayName: "Demo",
        family: "code-plugin",
        isOfficial: true,
        latestVersion: "1.2.3",
      },
      ready: true,
      checks: [
        {
          id: "clawpack",
          label: "ClawPack artifact",
          status: "pass",
          message: "Latest version has a ClawPack artifact.",
        },
      ],
      blockers: [],
    });

    await cmdPackageMigrationStatus(makeOpts(), "@scope/demo");

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      {
        method: "GET",
        path: "/api/v1/packages/%40scope%2Fdemo/readiness",
        token: undefined,
      },
      expect.anything(),
    );
    expect(mockLog).toHaveBeenCalledWith("@scope/demo migration: ready");
    expect(mockLog).toHaveBeenCalledWith("Version: 1.2.3");
    expect(mockLog).toHaveBeenCalledWith("Official: yes");
    expect(mockLog).toHaveBeenCalledWith("PASS clawpack: Latest version has a ClawPack artifact.");
  });

  it("lists package migration rows", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      items: [
        {
          migrationId: "officialPluginMigrations:1",
          bundledPluginId: "core.search",
          packageName: "@scope/demo",
          packageId: "pkg_1",
          owner: "platform",
          sourceRepo: "openclaw/openclaw",
          sourcePath: "plugins/search",
          sourceCommit: "abc123",
          phase: "blocked",
          blockers: ["missing ClawPack"],
          hostTargetsComplete: true,
          scanClean: false,
          moderationApproved: false,
          runtimeBundlesReady: false,
          notes: "needs publisher upload",
          createdAt: 100,
          updatedAt: 200,
        },
      ],
      nextCursor: null,
      done: true,
    });

    await cmdListPackageMigrations(makeOpts(), { phase: "blocked", limit: 10 });

    const url = new URL(httpMocks.apiRequest.mock.calls[0]?.[1].url as string);
    expect(url.pathname).toBe("/api/v1/packages/migrations");
    expect(url.searchParams.get("phase")).toBe("blocked");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(mockLog).toHaveBeenCalledWith("core.search blocked @scope/demo blockers:1");
    expect(mockLog).toHaveBeenCalledWith("  source: openclaw/openclaw plugins/search abc123");
    expect(mockLog).toHaveBeenCalledWith("  notes: needs publisher upload");
  });

  it("upserts package migration rows", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      migration: {
        migrationId: "officialPluginMigrations:1",
        bundledPluginId: "core.search",
        packageName: "@scope/demo",
        packageId: "pkg_1",
        owner: "platform",
        sourceRepo: "openclaw/openclaw",
        sourcePath: "plugins/search",
        sourceCommit: null,
        phase: "blocked",
        blockers: ["missing ClawPack"],
        hostTargetsComplete: true,
        scanClean: false,
        moderationApproved: false,
        runtimeBundlesReady: false,
        notes: null,
        createdAt: 100,
        updatedAt: 200,
      },
    });

    await cmdUpsertPackageMigration(makeOpts(), "core.search", {
      package: "@scope/demo",
      owner: "platform",
      sourceRepo: "openclaw/openclaw",
      sourcePath: "plugins/search",
      phase: "blocked",
      blockers: "missing ClawPack",
      hostTargetsComplete: true,
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      {
        method: "POST",
        path: "/api/v1/packages/migrations",
        token: "tkn",
        body: {
          bundledPluginId: "core.search",
          packageName: "@scope/demo",
          owner: "platform",
          sourceRepo: "openclaw/openclaw",
          sourcePath: "plugins/search",
          phase: "blocked",
          blockers: ["missing ClawPack"],
          hostTargetsComplete: true,
        },
      },
      expect.anything(),
    );
    expect(mockLog).toHaveBeenCalledWith("OK. Migration core.search is blocked for @scope/demo.");
  });

  it("publishes a code plugin package with an exact explicit payload", async () => {
    const workdir = await makeTmpWorkdir();
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(123_456_789);
    try {
      const folder = join(workdir, "demo-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "@scope/demo-plugin",
          displayName: "Demo Plugin",
          version: "1.0.0",
          files: ["dist", "openclaw.plugin.json"],
        }),
        "utf8",
      );
      await writeFile(join(folder, ".gitignore"), "dist/\n", "utf8");
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.plugin" }),
        "utf8",
      );
      await writeFile(join(folder, "dist", "index.js"), "export const demo = true;\n", "utf8");

      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_1",
        releaseId: "rel_1",
      });

      await cmdPublishPackage(makeOpts(workdir), "demo-plugin", {
        owner: "@openclaw",
        sourceRepo: "openclaw/demo-plugin",
        sourceCommit: "abc123",
        sourceRef: "refs/tags/v1.0.0",
      });

      expect(getPublishPayload()).toEqual({
        name: "@scope/demo-plugin",
        displayName: "Demo Plugin",
        ownerHandle: "openclaw",
        family: "code-plugin",
        version: "1.0.0",
        changelog: "",
        tags: ["latest"],
        source: {
          kind: "github",
          url: "https://github.com/openclaw/demo-plugin",
          repo: "openclaw/demo-plugin",
          ref: "refs/tags/v1.0.0",
          commit: "abc123",
          path: ".",
          importedAt: 123_456_789,
        },
      });
      expect(getUploadedFileNames()).toEqual([]);
      expect(getUploadedClawPackNames()).toEqual(["scope-demo-plugin-1.0.0.tgz"]);
      const uploadedPack = getUploadedClawPacks()[0];
      if (!uploadedPack) throw new Error("Missing uploaded ClawPack");
      const parsed = parseClawPack(new Uint8Array(await uploadedPack.arrayBuffer()));
      expect(parsed.entries.map((entry) => entry.path).sort()).toEqual([
        "dist/index.js",
        "openclaw.plugin.json",
        "package.json",
      ]);
      expect(uiMocks.spinner.succeed).toHaveBeenCalledWith(
        "OK. Published @scope/demo-plugin@1.0.0 (rel_1)",
      );
      expect(uiMocks.spinner.fail).not.toHaveBeenCalled();
      expect(mockLog).not.toHaveBeenCalled();
      expect(mockWrite).not.toHaveBeenCalled();
      dateSpy.mockRestore();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("publishes a ClawPack tarball without uploading extracted files", async () => {
    const workdir = await makeTmpWorkdir();
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(123_456_789);
    try {
      const packName = "demo-plugin-1.0.0.tgz";
      await writeFile(
        join(workdir, packName),
        npmPackFixture({
          "package/package.json": makeCodePluginPackageJson({
            name: "@scope/demo-plugin",
            displayName: "Demo Plugin",
            version: "1.0.0",
          }),
          "package/openclaw.plugin.json": JSON.stringify({ id: "demo.plugin" }),
          "package/dist/index.js": "export const demo = true;\n",
        }),
      );

      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_1",
        releaseId: "rel_1",
      });

      await cmdPublishPackage(makeOpts(workdir), packName, {
        sourceRepo: "openclaw/demo-plugin",
        sourceCommit: "abc123",
      });

      expect(getPublishPayload()).toEqual({
        name: "@scope/demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        version: "1.0.0",
        changelog: "",
        tags: ["latest"],
        source: {
          kind: "github",
          url: "https://github.com/openclaw/demo-plugin",
          repo: "openclaw/demo-plugin",
          ref: "abc123",
          commit: "abc123",
          path: ".",
          importedAt: 123_456_789,
        },
      });
      expect(getUploadedClawPackNames()).toEqual([packName]);
      expect(getUploadedFileNames()).toEqual([]);
      expect(uiMocks.spinner.succeed).toHaveBeenCalledWith(
        "OK. Published @scope/demo-plugin@1.0.0 (rel_1)",
      );
      dateSpy.mockRestore();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("packs a plugin folder through npm pack and validates the ClawPack", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "demo-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
      await mkdir(join(workdir, "packs"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "@scope/demo-plugin",
          displayName: "Demo Plugin",
          version: "1.0.0",
          description: "Demo plugin",
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.plugin" }),
        "utf8",
      );
      await writeFile(join(folder, "dist", "index.js"), "export const demo = true;\n", "utf8");

      await cmdPackPackage(makeOpts(workdir), "demo-plugin", {
        packDestination: "packs",
      });

      const packPath = join(workdir, "packs", "scope-demo-plugin-1.0.0.tgz");
      const parsed = parseClawPack(new Uint8Array(await readFile(packPath)));
      expect(parsed.packageName).toBe("@scope/demo-plugin");
      expect(parsed.packageVersion).toBe("1.0.0");
      expect(parsed.entries.map((entry) => entry.path)).toContain("openclaw.plugin.json");
      expect(mockLog).toHaveBeenCalledWith(`Path: ${packPath}`);
      expect(uiMocks.spinner.succeed).toHaveBeenCalledWith(
        `Packed @scope/demo-plugin@1.0.0 -> ${packPath}`,
      );
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("rejects a code plugin ClawPack with TypeScript entries and no compiled runtime", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const packName = "demo-plugin-1.0.0.tgz";
      await writeFile(
        join(workdir, packName),
        npmPackFixture({
          "package/package.json": makeCodePluginPackageJson({
            name: "@scope/demo-plugin",
            displayName: "Demo Plugin",
            version: "1.0.0",
            openclaw: {
              extensions: ["./index.ts"],
              compat: {
                pluginApi: ">=2026.3.24-beta.2",
              },
              build: {
                openclawVersion: "2026.3.24-beta.2",
              },
            },
          }),
          "package/openclaw.plugin.json": JSON.stringify({ id: "demo.plugin" }),
          "package/index.ts": "export const demo = true;\n",
        }),
      );

      await expect(
        cmdPublishPackage(makeOpts(workdir), packName, {
          sourceRepo: "openclaw/demo-plugin",
          sourceCommit: "abc123",
        }),
      ).rejects.toThrow(
        "@scope/demo-plugin requires compiled runtime output for TypeScript entry ./index.ts",
      );
      expect(httpMocks.apiRequestForm).not.toHaveBeenCalled();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("rejects a ClawPack tarball without openclaw.plugin.json", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const packName = "demo-plugin-1.0.0.tgz";
      await writeFile(
        join(workdir, packName),
        npmPackFixture({
          "package/package.json": makeCodePluginPackageJson({
            name: "demo-plugin",
            displayName: "Demo Plugin",
            version: "1.0.0",
          }),
          "package/dist/index.js": "export const demo = true;\n",
        }),
      );

      await expect(
        cmdPublishPackage(makeOpts(workdir), packName, {
          sourceRepo: "openclaw/demo-plugin",
          sourceCommit: "abc123",
        }),
      ).rejects.toThrow("ClawPack must contain package/openclaw.plugin.json");
      expect(httpMocks.apiRequestForm).not.toHaveBeenCalled();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("mints a short-lived publish token from GitHub Actions OIDC in CI", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://token.actions.githubusercontent.com/oidc";
      process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "gh-request-token";
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ value: "github-oidc-jwt" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const folder = join(workdir, "demo-plugin");
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "@scope/demo-plugin",
          displayName: "Demo Plugin",
          version: "1.0.0",
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.plugin" }),
        "utf8",
      );

      httpMocks.apiRequest.mockResolvedValueOnce({
        token: "clh_short_publish",
        expiresAt: 1_234_567_890,
      });
      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_1",
        releaseId: "rel_1",
      });

      await cmdPublishPackage(makeOpts(workdir), "demo-plugin", {
        sourceRepo: "openclaw/demo-plugin",
        sourceCommit: "abc123",
      });

      expect(authTokenMocks.requireAuthToken).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        new URL("https://token.actions.githubusercontent.com/oidc?audience=clawhub"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer gh-request-token",
          }),
        }),
      );
      expect(httpMocks.apiRequest).toHaveBeenCalledWith(
        "https://clawhub.ai",
        expect.objectContaining({
          method: "POST",
          path: "/api/v1/publish/token/mint",
          body: {
            packageName: "@scope/demo-plugin",
            version: "1.0.0",
            githubOidcToken: "github-oidc-jwt",
          },
        }),
        expect.anything(),
      );
      const publishArgs = httpMocks.apiRequestForm.mock.calls[0]?.[1] as
        | { token?: string }
        | undefined;
      expect(publishArgs?.token).toBe("clh_short_publish");
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("uses normal token auth for manual override publishes", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://token.actions.githubusercontent.com/oidc";
      process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "gh-request-token";
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const folder = join(workdir, "demo-plugin");
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "demo-plugin",
          displayName: "Demo Plugin",
          version: "1.0.0",
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.plugin" }),
        "utf8",
      );

      authTokenMocks.requireAuthToken.mockResolvedValueOnce("manual-token");
      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_1",
        releaseId: "rel_1",
      });

      await cmdPublishPackage(makeOpts(workdir), "demo-plugin", {
        manualOverrideReason: "break glass",
        sourceRepo: "openclaw/demo-plugin",
        sourceCommit: "abc123",
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(httpMocks.apiRequest).not.toHaveBeenCalled();
      const publishArgs = httpMocks.apiRequestForm.mock.calls[0]?.[1] as
        | { token?: string; form?: FormData }
        | undefined;
      expect(publishArgs?.token).toBe("manual-token");
      const payloadEntry = publishArgs?.form?.get("payload");
      if (typeof payloadEntry !== "string") {
        throw new Error("Missing publish payload");
      }
      expect(JSON.parse(payloadEntry)).toMatchObject({
        manualOverrideReason: "break glass",
      });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("falls back to a normal auth token when trusted minting is unavailable", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://token.actions.githubusercontent.com/oidc";
      process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "gh-request-token";
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ value: "github-oidc-jwt" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const folder = join(workdir, "demo-plugin");
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "@scope/demo-plugin",
          displayName: "Demo Plugin",
          version: "1.0.0",
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.plugin" }),
        "utf8",
      );

      authTokenMocks.requireAuthToken.mockResolvedValueOnce("fallback-token");
      httpMocks.apiRequest.mockRejectedValueOnce(
        Object.assign(new Error("Trusted publisher config is not set"), { status: 403 }),
      );
      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_1",
        releaseId: "rel_1",
      });

      await cmdPublishPackage(makeOpts(workdir), "demo-plugin", {
        sourceRepo: "openclaw/demo-plugin",
        sourceCommit: "abc123",
      });

      const publishArgs = httpMocks.apiRequestForm.mock.calls[0]?.[1] as
        | { token?: string }
        | undefined;
      expect(publishArgs?.token).toBe("fallback-token");
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("falls back to a normal auth token when trusted minting returns a 400", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://token.actions.githubusercontent.com/oidc";
      process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "gh-request-token";
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ value: "github-oidc-jwt" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const folder = join(workdir, "demo-plugin");
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "@scope/demo-plugin",
          displayName: "Demo Plugin",
          version: "1.0.0",
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.plugin" }),
        "utf8",
      );

      authTokenMocks.requireAuthToken.mockResolvedValueOnce("fallback-token");
      httpMocks.apiRequest.mockRejectedValueOnce(
        Object.assign(new Error("Trusted publishing requires workflow_dispatch"), { status: 400 }),
      );
      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_1",
        releaseId: "rel_1",
      });

      await cmdPublishPackage(makeOpts(workdir), "demo-plugin", {
        sourceRepo: "openclaw/demo-plugin",
        sourceCommit: "abc123",
      });

      const publishArgs = httpMocks.apiRequestForm.mock.calls[0]?.[1] as
        | { token?: string }
        | undefined;
      expect(publishArgs?.token).toBe("fallback-token");
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("falls back to a normal auth token when requesting the GitHub OIDC token fails", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://token.actions.githubusercontent.com/oidc";
      process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "gh-request-token";
      const fetchMock = vi.fn().mockResolvedValue(
        new Response("oidc unavailable", {
          status: 500,
          statusText: "Internal Server Error",
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const folder = join(workdir, "demo-plugin");
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "@scope/demo-plugin",
          displayName: "Demo Plugin",
          version: "1.0.0",
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.plugin" }),
        "utf8",
      );

      authTokenMocks.requireAuthToken.mockResolvedValueOnce("fallback-token");
      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_1",
        releaseId: "rel_1",
      });

      await cmdPublishPackage(makeOpts(workdir), "demo-plugin", {
        sourceRepo: "openclaw/demo-plugin",
        sourceCommit: "abc123",
      });

      const publishArgs = httpMocks.apiRequestForm.mock.calls[0]?.[1] as
        | { token?: string }
        | undefined;
      expect(publishArgs?.token).toBe("fallback-token");
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("publishes a bundle plugin package with real bundle marker detection", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "demo-bundle");
      await mkdir(join(folder, "dist"), { recursive: true });
      await mkdir(join(folder, ".codex-plugin"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        JSON.stringify({
          name: "demo-bundle",
          displayName: "Demo Bundle",
          version: "0.4.0",
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.bundle" }),
        "utf8",
      );
      await writeFile(
        join(folder, ".codex-plugin", "plugin.json"),
        JSON.stringify({ name: "Demo Bundle", skills: ["skills"] }),
        "utf8",
      );
      await writeFile(join(folder, "dist", "plugin.wasm"), "binary", "utf8");

      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_bundle",
        releaseId: "rel_bundle",
      });

      await cmdPublishPackage(makeOpts(workdir), "demo-bundle", {
        bundleFormat: "openclaw-bundle",
        hostTargets: "desktop,mobile",
      });

      expect(getPublishPayload()).toEqual({
        name: "demo-bundle",
        displayName: "Demo Bundle",
        family: "bundle-plugin",
        version: "0.4.0",
        changelog: "",
        tags: ["latest"],
        bundle: {
          format: "openclaw-bundle",
          hostTargets: ["desktop", "mobile"],
        },
      });
      expect(getUploadedFileNames()).toEqual([
        ".codex-plugin/plugin.json",
        "dist/plugin.wasm",
        "openclaw.plugin.json",
        "package.json",
      ]);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("rejects code-plugin publish without source metadata", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "demo-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({ name: "demo-plugin", version: "1.0.0" }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.plugin" }),
        "utf8",
      );

      await expect(cmdPublishPackage(makeOpts(workdir), "demo-plugin", {})).rejects.toThrow(
        "--source-repo and --source-commit required for code plugins",
      );
      expect(httpMocks.apiRequestForm).not.toHaveBeenCalled();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("rejects code-plugin publish when openclaw.plugin.json is missing", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "demo-plugin");
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({ name: "demo-plugin", displayName: "Demo", version: "1.0.0" }),
        "utf8",
      );

      await expect(
        cmdPublishPackage(makeOpts(workdir), "demo-plugin", {
          family: "code-plugin",
          sourceRepo: "openclaw/demo-plugin",
          sourceCommit: "abc123",
        }),
      ).rejects.toThrow("openclaw.plugin.json required");
      expect(httpMocks.apiRequestForm).not.toHaveBeenCalled();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("rejects code-plugin publish when required OpenClaw compatibility metadata is missing", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "demo-plugin");
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        JSON.stringify({
          name: "demo-plugin",
          displayName: "Demo Plugin",
          version: "1.0.0",
          openclaw: {
            extensions: ["./index.ts"],
          },
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.plugin", configSchema: { type: "object" } }),
        "utf8",
      );

      await expect(
        cmdPublishPackage(makeOpts(workdir), "demo-plugin", {
          sourceRepo: "openclaw/demo-plugin",
          sourceCommit: "abc123",
        }),
      ).rejects.toThrow(
        "openclaw.compat.pluginApi is required for external code plugins published to ClawHub.",
      );
      expect(httpMocks.apiRequestForm).not.toHaveBeenCalled();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("publishes code plugins when host targets are missing", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "demo-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        JSON.stringify({
          name: "demo-plugin",
          displayName: "Demo Plugin",
          version: "1.0.0",
          openclaw: {
            extensions: ["./index.ts"],
            compat: { pluginApi: ">=2026.3.24-beta.2" },
            build: { openclawVersion: "2026.3.24-beta.2" },
            environment: {},
          },
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.plugin", configSchema: { type: "object" } }),
        "utf8",
      );
      await writeFile(join(folder, "dist", "index.js"), "export const demo = true;\n", "utf8");

      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_1",
        releaseId: "rel_1",
      });

      await cmdPublishPackage(makeOpts(workdir), "demo-plugin", {
        sourceRepo: "openclaw/demo-plugin",
        sourceCommit: "abc123",
      });

      expect(getPublishPayload()).toMatchObject({
        name: "demo-plugin",
        family: "code-plugin",
        version: "1.0.0",
      });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("rejects bundle-plugin publish when openclaw.plugin.json is missing", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "demo-bundle");
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        JSON.stringify({ name: "demo-bundle", displayName: "Demo Bundle", version: "0.1.0" }),
        "utf8",
      );

      await expect(
        cmdPublishPackage(makeOpts(workdir), "demo-bundle", { family: "bundle-plugin" }),
      ).rejects.toThrow("openclaw.plugin.json required");
      expect(httpMocks.apiRequestForm).not.toHaveBeenCalled();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("respects package ignore rules and built-in ignored directories", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "ignored-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
      await mkdir(join(folder, "node_modules", "pkg"), { recursive: true });
      await mkdir(join(folder, ".git"), { recursive: true });
      await mkdir(join(folder, ".codex-plugin"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        JSON.stringify({
          name: "ignored-plugin",
          displayName: "Ignored Plugin",
          version: "1.0.0",
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "ignored.plugin" }),
        "utf8",
      );
      await writeFile(
        join(folder, ".codex-plugin", "plugin.json"),
        JSON.stringify({ name: "Ignored Plugin", skills: ["skills"] }),
        "utf8",
      );
      await writeFile(join(folder, ".clawhubignore"), "ignored.txt\n", "utf8");
      await writeFile(join(folder, "dist", "index.js"), "export {};\n", "utf8");
      await writeFile(join(folder, "ignored.txt"), "ignore me\n", "utf8");
      await writeFile(
        join(folder, "node_modules", "pkg", "index.js"),
        "module.exports = {};\n",
        "utf8",
      );
      await writeFile(join(folder, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");

      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_ignored",
        releaseId: "rel_ignored",
      });

      await cmdPublishPackage(makeOpts(workdir), "ignored-plugin", {
        sourceRepo: "openclaw/ignored-plugin",
        sourceCommit: "abc123",
      });

      expect(getUploadedFileNames()).toEqual([
        ".clawhubignore",
        ".codex-plugin/plugin.json",
        "dist/index.js",
        "openclaw.plugin.json",
        "package.json",
      ]);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("reports publish failures through the spinner without writing to stdout", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "broken-plugin");
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "broken-plugin",
          displayName: "Broken Plugin",
          version: "1.0.0",
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "broken.plugin" }),
        "utf8",
      );

      httpMocks.apiRequestForm.mockRejectedValueOnce(new Error("Registry rejected upload"));

      await expect(
        cmdPublishPackage(makeOpts(workdir), "broken-plugin", {
          sourceRepo: "openclaw/broken-plugin",
          sourceCommit: "deadbeef",
        }),
      ).rejects.toThrow("Registry rejected upload");

      expect(uiMocks.spinner.fail).toHaveBeenCalledWith("Registry rejected upload");
      expect(uiMocks.spinner.succeed).not.toHaveBeenCalled();
      expect(mockLog).not.toHaveBeenCalled();
      expect(mockWrite).not.toHaveBeenCalled();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("auto-detects local git source metadata and matches the explicit payload", async () => {
    const workdir = await makeTmpWorkdir();
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(987_654_321);
    try {
      const folder = join(workdir, "demo-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "@scope/demo-plugin",
          displayName: "Demo Plugin",
          version: "1.0.0",
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.plugin" }),
        "utf8",
      );
      await writeFile(join(folder, "dist", "index.js"), "export const demo = true;\n", "utf8");

      runGit(folder, ["init", "-b", "main"]);
      runGit(folder, ["remote", "add", "origin", "git@github.com:openclaw/demo-plugin.git"]);
      runGit(folder, ["add", "."]);
      runGit(folder, [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "init",
      ]);
      const commit = runGit(folder, ["rev-parse", "HEAD"]);
      runGit(folder, ["-c", "tag.gpgSign=false", "tag", "v1.0.0"]);

      httpMocks.apiRequestForm.mockResolvedValue({
        ok: true,
        packageId: "pkg_1",
        releaseId: "rel_1",
      });

      await cmdPublishPackage(makeOpts(workdir), "demo-plugin", {
        sourceRepo: "openclaw/demo-plugin",
        sourceCommit: commit,
        sourceRef: "v1.0.0",
      });
      const explicitPayload = getPublishPayload();
      const explicitFiles = getUploadedFileNames();

      httpMocks.apiRequestForm.mockClear();
      await cmdPublishPackage(makeOpts(workdir), "demo-plugin", {});
      const inferredPayload = getPublishPayload();
      const inferredFiles = getUploadedFileNames();

      expect(inferredPayload).toEqual(explicitPayload);
      expect(inferredFiles).toEqual(explicitFiles);
      dateSpy.mockRestore();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("lets explicit source flags override inferred git metadata", async () => {
    const workdir = await makeTmpWorkdir();
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(222_222_222);
    try {
      const folder = join(workdir, "demo-plugin");
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "demo-plugin",
          displayName: "Demo Plugin",
          version: "1.0.0",
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.plugin" }),
        "utf8",
      );

      runGit(folder, ["init", "-b", "main"]);
      runGit(folder, ["remote", "add", "origin", "git@github.com:openclaw/demo-plugin.git"]);
      runGit(folder, ["add", "."]);
      runGit(folder, [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "init",
      ]);

      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_1",
        releaseId: "rel_1",
      });

      await cmdPublishPackage(makeOpts(workdir), "demo-plugin", {
        sourceRepo: "openclaw/override-plugin",
        sourceCommit: "feedface",
        sourceRef: "refs/heads/release",
        sourcePath: "custom/path",
      });

      expect(getPublishPayload()).toEqual({
        name: "demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        version: "1.0.0",
        changelog: "",
        tags: ["latest"],
        source: {
          kind: "github",
          url: "https://github.com/openclaw/override-plugin",
          repo: "openclaw/override-plugin",
          ref: "refs/heads/release",
          commit: "feedface",
          path: "custom/path",
          importedAt: 222_222_222,
        },
      });
      dateSpy.mockRestore();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("preserves inferred source subpaths for nested local plugin folders", async () => {
    const workdir = await makeTmpWorkdir();
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(333_333_333);
    try {
      const folder = join(workdir, "packages", "demo-plugin");
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "demo-plugin",
          displayName: "Demo Plugin",
          version: "1.0.0",
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.plugin", configSchema: { type: "object" } }),
        "utf8",
      );

      runGit(workdir, ["init", "-b", "main"]);
      runGit(workdir, ["remote", "add", "origin", "git@github.com:openclaw/demo-plugin.git"]);
      runGit(workdir, ["add", "."]);
      runGit(workdir, [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "init",
      ]);

      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_1",
        releaseId: "rel_1",
      });

      await cmdPublishPackage(makeOpts(workdir), "packages/demo-plugin", {});

      expect(getPublishPayload()).toEqual({
        name: "demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        version: "1.0.0",
        changelog: "",
        tags: ["latest"],
        source: {
          kind: "github",
          url: "https://github.com/openclaw/demo-plugin",
          repo: "openclaw/demo-plugin",
          ref: "main",
          commit: expect.any(String),
          path: "packages/demo-plugin",
          importedAt: 333_333_333,
        },
      });
      dateSpy.mockRestore();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("uses --source-path as the package folder for GitHub shorthand sources", async () => {
    const workdir = await makeTmpWorkdir();
    const originalFetch = globalThis.fetch;
    const commit = "0123456789abcdef0123456789abcdef01234567";
    const archiveBytes = zipSync({
      "repo-root/plugins/demo/package.json": new TextEncoder().encode(
        makeCodePluginPackageJson({
          name: "@scope/demo-plugin",
          displayName: "Demo Plugin",
          version: "1.0.0",
        }),
      ),
      "repo-root/plugins/demo/openclaw.plugin.json": new TextEncoder().encode(
        JSON.stringify({ id: "demo.plugin" }),
      ),
      "repo-root/plugins/demo/dist/index.js": new TextEncoder().encode("export {};\n"),
      "repo-root/other/package.json": new TextEncoder().encode('{"name":"wrong"}\n'),
    });
    const archiveBody = archiveBytes.buffer.slice(
      archiveBytes.byteOffset,
      archiveBytes.byteOffset + archiveBytes.byteLength,
    ) as ArrayBuffer;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/repos/owner/repo/commits/main")) {
        return new Response(JSON.stringify({ sha: commit }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/repos/owner/repo/zipball/${commit}`)) {
        return new Response(archiveBody, {
          status: 200,
          headers: { "content-type": "application/zip" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    Object.defineProperty(globalThis, "fetch", {
      value: fetchMock,
      configurable: true,
      writable: true,
    });
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(555_555_555);

    try {
      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_1",
        releaseId: "rel_1",
      });

      await cmdPublishPackage(makeOpts(workdir), "owner/repo@main", {
        sourcePath: "plugins/demo",
      });

      expect(getUploadedFileNames()).toEqual([]);
      expect(getUploadedClawPackNames()).toEqual(["scope-demo-plugin-1.0.0.tgz"]);
      expect(getPublishPayload()).toEqual({
        name: "@scope/demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        version: "1.0.0",
        changelog: "",
        tags: ["latest"],
        source: {
          kind: "github",
          url: "https://github.com/owner/repo",
          repo: "owner/repo",
          ref: "main",
          commit,
          path: "plugins/demo",
          importedAt: 555_555_555,
        },
      });
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        value: originalFetch,
        configurable: true,
        writable: true,
      });
      dateSpy.mockRestore();
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("supports dry-run without auth or publish and prints a summary", async () => {
    const workdir = await makeTmpWorkdir();
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(444_444_444);
    try {
      const folder = join(workdir, "demo-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "demo-plugin",
          displayName: "Demo Plugin",
          version: "1.0.0",
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.plugin" }),
        "utf8",
      );
      await writeFile(join(folder, "dist", "index.js"), "export const demo = true;\n", "utf8");

      runGit(folder, ["init", "-b", "main"]);
      runGit(folder, ["remote", "add", "origin", "git@github.com:openclaw/demo-plugin.git"]);
      runGit(folder, ["add", "."]);
      runGit(folder, [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "init",
      ]);
      const commit = runGit(folder, ["rev-parse", "HEAD"]);

      await cmdPublishPackage(makeOpts(workdir), "demo-plugin", { dryRun: true });

      expect(authTokenMocks.requireAuthToken).not.toHaveBeenCalled();
      expect(httpMocks.apiRequestForm).not.toHaveBeenCalled();
      expect(mockLog.mock.calls.map((call) => call[0])).toEqual(
        expect.arrayContaining([
          "Dry run - nothing will be published.",
          expect.stringMatching(/Source:\s+github:openclaw\/demo-plugin@main/),
          expect.stringMatching(/Name:\s+demo-plugin/),
          expect.stringMatching(new RegExp(`Commit:\\s+${commit}`)),
          "Files:",
        ]),
      );
      expect(mockWrite).not.toHaveBeenCalled();
      dateSpy.mockRestore();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("supports dry-run json output without auth or publish", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "demo-plugin");
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "demo-plugin",
          displayName: "Demo Plugin",
          version: "1.0.0",
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.plugin" }),
        "utf8",
      );

      runGit(folder, ["init", "-b", "main"]);
      runGit(folder, ["remote", "add", "origin", "git@github.com:openclaw/demo-plugin.git"]);
      runGit(folder, ["add", "."]);
      runGit(folder, [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "init",
      ]);

      await cmdPublishPackage(makeOpts(workdir), "demo-plugin", { dryRun: true, json: true });

      expect(authTokenMocks.requireAuthToken).not.toHaveBeenCalled();
      expect(httpMocks.apiRequestForm).not.toHaveBeenCalled();
      expect(mockLog).not.toHaveBeenCalled();
      expect(mockWrite).toHaveBeenCalledTimes(1);
      const output = String(mockWrite.mock.calls[0]?.[0] ?? "").trim();
      expect(JSON.parse(output)).toEqual({
        source: "github:openclaw/demo-plugin@main",
        name: "demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        version: "1.0.0",
        commit: expect.any(String),
        files: 2,
        totalBytes: expect.any(Number),
      });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("gets trusted publisher config for a package", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      trustedPublisher: {
        provider: "github-actions",
        repository: "openclaw/openclaw",
        repositoryId: "1",
        repositoryOwner: "openclaw",
        repositoryOwnerId: "2",
        workflowFilename: "plugin-clawhub-release.yml",
        environment: "clawhub-release",
      },
    });

    await cmdGetPackageTrustedPublisher(makeOpts(), "@openclaw/zalo");

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/packages/%40openclaw%2Fzalo/trusted-publisher",
      }),
      expect.anything(),
    );
    expect(mockLog).toHaveBeenCalledWith("Provider: github-actions");
    expect(mockLog).toHaveBeenCalledWith("Repository: openclaw/openclaw");
    expect(mockLog).toHaveBeenCalledWith("Workflow: plugin-clawhub-release.yml");
    expect(mockLog).toHaveBeenCalledWith("Environment: clawhub-release");
  });

  it("gets trusted publisher config without a pinned environment", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      trustedPublisher: {
        provider: "github-actions",
        repository: "openclaw/openclaw",
        repositoryId: "1",
        repositoryOwner: "openclaw",
        repositoryOwnerId: "2",
        workflowFilename: "plugin-clawhub-release.yml",
      },
    });

    await cmdGetPackageTrustedPublisher(makeOpts(), "@openclaw/zalo");

    expect(mockLog).toHaveBeenCalledWith("Provider: github-actions");
    expect(mockLog).toHaveBeenCalledWith("Repository: openclaw/openclaw");
    expect(mockLog).toHaveBeenCalledWith("Workflow: plugin-clawhub-release.yml");
    expect(mockLog).not.toHaveBeenCalledWith(expect.stringContaining("Environment:"));
  });

  it("sets trusted publisher config for a package", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      trustedPublisher: {
        provider: "github-actions",
        repository: "openclaw/openclaw",
        repositoryId: "1",
        repositoryOwner: "openclaw",
        repositoryOwnerId: "2",
        workflowFilename: "plugin-clawhub-release.yml",
        environment: "clawhub-release",
      },
    });

    await cmdSetPackageTrustedPublisher(makeOpts(), "@openclaw/zalo", {
      repository: "openclaw/openclaw",
      workflowFilename: "plugin-clawhub-release.yml",
      environment: "clawhub-release",
    });

    expect(authTokenMocks.requireAuthToken).toHaveBeenCalled();
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/packages/%40openclaw%2Fzalo/trusted-publisher",
        token: "tkn",
        body: {
          repository: "openclaw/openclaw",
          workflowFilename: "plugin-clawhub-release.yml",
          environment: "clawhub-release",
        },
      }),
      expect.anything(),
    );
  });

  it("sets trusted publisher config for a package without environment", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      trustedPublisher: {
        provider: "github-actions",
        repository: "openclaw/openclaw",
        repositoryId: "1",
        repositoryOwner: "openclaw",
        repositoryOwnerId: "2",
        workflowFilename: "plugin-clawhub-release.yml",
      },
    });

    await cmdSetPackageTrustedPublisher(makeOpts(), "@openclaw/zalo", {
      repository: "openclaw/openclaw",
      workflowFilename: "plugin-clawhub-release.yml",
    });

    expect(authTokenMocks.requireAuthToken).toHaveBeenCalled();
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/packages/%40openclaw%2Fzalo/trusted-publisher",
        token: "tkn",
        body: {
          repository: "openclaw/openclaw",
          workflowFilename: "plugin-clawhub-release.yml",
        },
      }),
      expect.anything(),
    );
  });

  it("deletes trusted publisher config for a package", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true });

    await cmdDeletePackageTrustedPublisher(makeOpts(), "@openclaw/zalo");

    expect(authTokenMocks.requireAuthToken).toHaveBeenCalled();
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "DELETE",
        path: "/api/v1/packages/%40openclaw%2Fzalo/trusted-publisher",
        token: "tkn",
      }),
      undefined,
    );
  });

  it("soft-deletes a package with confirmation bypass", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true });

    await cmdDeletePackage(makeOpts(), "@openclaw/zalo", { yes: true }, false);

    expect(authTokenMocks.requireAuthToken).toHaveBeenCalled();
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "DELETE",
        path: "/api/v1/packages/%40openclaw%2Fzalo",
        token: "tkn",
      }),
      expect.anything(),
    );
  });

  it("requires --yes for non-interactive package deletes", async () => {
    await expect(cmdDeletePackage(makeOpts(), "@openclaw/zalo", {}, false)).rejects.toThrow(
      /--yes/i,
    );
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });
});
