/* @vitest-environment node */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
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
  cmdDeletePackageTrustedPublisher,
  cmdDownloadPackage,
  cmdExplorePackages,
  cmdGetPackageTrustedPublisher,
  cmdInspectPackage,
  cmdPackageStorePackBackfill,
  cmdPackageStorePackIndexBackfill,
  cmdPackageStorePackMigrationStatus,
  cmdPackageStorePackRevoke,
  cmdPublishPackage,
  cmdSetPackageTrustedPublisher,
  cmdVerifyPackageStorePack,
} = await import("./packages");

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

function makeCodePluginPackageJson(overrides: Record<string, unknown>) {
  return JSON.stringify({
    openclaw: {
      extensions: ["./dist/index.js"],
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
      hostTarget: "darwin-arm64",
      environment: "browser",
    });

    const request = httpMocks.apiRequest.mock.calls[0]?.[1] as { url?: string } | undefined;
    const url = new URL(String(request?.url));
    expect(url.pathname).toBe("/api/v1/packages/search");
    expect(url.searchParams.get("q")).toBe("demo plugin");
    expect(url.searchParams.get("family")).toBe("code-plugin");
    expect(url.searchParams.get("executesCode")).toBe("true");
    expect(url.searchParams.get("hostTarget")).toBe("darwin-arm64");
    expect(url.searchParams.get("environment")).toBe("browser");
  });

  it("supports skill family package browse requests", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    });

    await cmdExplorePackages(makeOpts(), "", {
      family: "skill",
      hostTarget: "linux-x64-glibc",
      environment: "desktop",
      limit: 7,
    });

    const request = httpMocks.apiRequest.mock.calls[0]?.[1] as { url?: string } | undefined;
    const url = new URL(String(request?.url));
    expect(url.pathname).toBe("/api/v1/packages");
    expect(url.searchParams.get("family")).toBe("skill");
    expect(url.searchParams.get("hostTarget")).toBe("linux-x64-glibc");
    expect(url.searchParams.get("environment")).toBe("desktop");
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

  it("prints StorePack metadata while inspecting a package", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
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
        storepack: {
          available: true,
          specVersion: 1,
          format: "zip",
          sha256: "a".repeat(64),
          size: 123,
          fileCount: 3,
          manifestSha256: "b".repeat(64),
          builtAt: 1_763_000_000_000,
          buildVersion: "clawhub-storepack-v1",
          hostTargets: [
            { os: "darwin", arch: "arm64", supportState: "supported" },
            { os: "linux", arch: "x64", libc: "glibc", supportState: "supported" },
          ],
          environment: { requiresNetwork: true },
          runtimeBundles: [],
        },
      },
      owner: null,
    });

    await cmdInspectPackage(makeOpts(), "demo", {});

    expect(mockLog).toHaveBeenCalledWith("StorePack: available");
    expect(mockLog).toHaveBeenCalledWith(`StorePack SHA-256: ${"a".repeat(64)}`);
    expect(mockLog).toHaveBeenCalledWith("StorePack Targets: darwin-arm64, linux-x64-glibc");
  });

  it("downloads a StorePack package archive", async () => {
    const workdir = await makeTmpWorkdir();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn(async () => {
      return new Response(bytes, {
        headers: {
          "content-disposition": 'attachment; filename="demo.storepack.zip"',
          "x-clawhub-storepack-sha256": "c".repeat(64),
          "x-clawhub-storepack-spec-version": "1",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await cmdDownloadPackage(makeOpts(workdir), "demo", { json: true });

      expect(fetchMock).toHaveBeenCalledWith(
        new URL("https://clawhub.ai/api/v1/packages/demo/download"),
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: "application/zip" }),
        }),
      );
      expect(await readFile(join(workdir, "demo.storepack.zip"))).toEqual(Buffer.from(bytes));
      expect(mockWrite.mock.calls.map((call) => String(call[0])).join("")).toContain(
        `"storepackSha256": "${"c".repeat(64)}"`,
      );
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("verifies StorePack archives and rejects digest mismatches", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const zip = zipSync({
        "package/STOREPACK.json": new TextEncoder().encode(
          JSON.stringify({
            specVersion: 1,
            package: { name: "demo", version: "1.0.0" },
          }),
        ),
        "package/package.json": new TextEncoder().encode("{}"),
      });
      const file = join(workdir, "demo.storepack.zip");
      await writeFile(file, zip);
      const sha256 = createHash("sha256").update(zip).digest("hex");

      await cmdVerifyPackageStorePack(file, { sha256, json: true });
      expect(mockWrite.mock.calls.map((call) => String(call[0])).join("")).toContain(`"ok": true`);
      await expect(cmdVerifyPackageStorePack(file, { sha256: "0".repeat(64) })).rejects.toThrow(
        "StorePack digest mismatch",
      );
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("fetches StorePack migration status for admins", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      missingSample: [],
      missingSampleSize: 0,
      generatedStorePackSampleSize: 2,
      generatedStorePackBytes: 2048,
      sampleLimit: 25,
    });

    await cmdPackageStorePackMigrationStatus(makeOpts(), { limit: 25, json: true });

    const request = httpMocks.apiRequest.mock.calls[0]?.[1] as
      | { method?: string; url?: string; token?: string }
      | undefined;
    expect(request?.method).toBe("GET");
    expect(request?.token).toBe("tkn");
    const url = new URL(String(request?.url));
    expect(url.pathname).toBe("/api/v1/packages/storepack/migration-status");
    expect(url.searchParams.get("limit")).toBe("25");
    expect(mockWrite.mock.calls.map((call) => String(call[0])).join("")).toContain(
      "generatedStorePackSampleSize",
    );
  });

  it("runs StorePack backfill batches for admins", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      processed: 2,
      succeeded: 2,
      failed: 0,
      results: [],
    });

    await cmdPackageStorePackBackfill(makeOpts(), { limit: 2 });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      {
        method: "POST",
        path: "/api/v1/packages/storepack/backfill",
        token: "tkn",
        body: { limit: 2 },
      },
      undefined,
    );
    expect(mockLog).toHaveBeenCalledWith("StorePack backfill");
    expect(mockLog).toHaveBeenCalledWith("Succeeded: 2");
  });

  it("runs StorePack index backfill batches for admins", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      processed: 2,
      succeeded: 2,
      failed: 0,
      results: [],
      continueCursor: "cursor:2",
      isDone: false,
    });

    await cmdPackageStorePackIndexBackfill(makeOpts(), { limit: 2, cursor: "cursor:1" });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      {
        method: "POST",
        path: "/api/v1/packages/storepack/index-backfill",
        token: "tkn",
        body: { limit: 2, cursor: "cursor:1" },
      },
      undefined,
    );
    expect(mockLog).toHaveBeenCalledWith("StorePack index backfill");
    expect(mockLog).toHaveBeenCalledWith("Next cursor: cursor:2");
  });

  it("revokes StorePack artifacts for moderators", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      packageId: "packages:1",
      releaseId: "packageReleases:1",
      version: "1.0.0",
      sha256: "d".repeat(64),
      revokedArtifactCount: 1,
    });

    await cmdPackageStorePackRevoke(makeOpts(), "@openclaw/kitchen-sink", "1.0.0", {
      reason: "malware confirmed",
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      {
        method: "POST",
        path: "/api/v1/packages/%40openclaw%2Fkitchen-sink/versions/1.0.0/storepack/revoke",
        token: "tkn",
        body: { reason: "malware confirmed" },
      },
      undefined,
    );
    expect(mockLog).toHaveBeenCalledWith("StorePack revoked");
    expect(mockLog).toHaveBeenCalledWith(`SHA-256: ${"d".repeat(64)}`);
    expect(mockLog).toHaveBeenCalledWith("Revoked artifacts: 1");
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
      expect(getUploadedFileNames()).toEqual([
        ".gitignore",
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

  it("publishes a bundle plugin package with manifest-driven family detection", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "demo-bundle");
      await mkdir(join(folder, "dist"), { recursive: true });
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
        join(folder, "openclaw.bundle.json"),
        JSON.stringify({ id: "demo.bundle", hostTargets: ["desktop", "mobile"] }),
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
        "dist/plugin.wasm",
        "openclaw.bundle.json",
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
      await mkdir(folder, { recursive: true });
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

  it("rejects bundle-plugin publish when host targets cannot be resolved", async () => {
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
      ).rejects.toThrow("Bundle plugins need openclaw.bundle.json or --host-targets");
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
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
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

      expect(getUploadedFileNames()).toEqual([
        "dist/index.js",
        "openclaw.plugin.json",
        "package.json",
      ]);
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
});
