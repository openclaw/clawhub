/* @vitest-environment node */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
const uiMocks = createUiModuleMocks({ interactive: true });
const inspectorMocks = {
  pluginRoot: {
    runCheck: vi.fn(),
  },
  reports: {
    renderTextSummary: vi.fn((report: { status?: string }) => `Plugin Inspector: ${report.status}`),
    sanitizeArtifact: vi.fn((report: unknown) => report),
  },
  ci: {
    writeOutputs: vi.fn(),
  },
};
const originalOidcRequestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
const originalOidcRequestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

vi.mock("../../http.js", () => httpMocks.moduleFactory());
vi.mock("../registry.js", () => registryMocks.moduleFactory());
vi.mock("../authToken.js", () => authTokenMocks.moduleFactory());
vi.mock("../ui.js", () => uiMocks.moduleFactory());
vi.mock("@openclaw/plugin-inspector", () => inspectorMocks);

const {
  cmdDeletePackage,
  cmdDeletePackageTrustedPublisher,
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
  cmdSetPackageTrustedPublisher,
  cmdTransferPackage,
  cmdUndeletePackage,
  cmdValidatePackage,
  cmdVerifyPackage,
} = await import("./packages");
const {
  cmdListPackageMigrations,
  cmdListPackageReports,
  cmdModeratePackageRelease,
  cmdPackageModerationQueue,
  cmdTriagePackageReport,
  cmdUpsertPackageMigration,
} = await import("../../../../clawhub-admin/src/commands/packages");
const { parseClawPack } = await import("../../clawpack");

const mockLog = vi.spyOn(console, "log").mockImplementation(() => {});
const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

function makeOpts(workdir = "/work") {
  return makeGlobalOpts(workdir);
}

async function makeTmpWorkdir() {
  return await mkdtemp(join(tmpdir(), "clawhub-package-"));
}

async function listClawPackTempDirs() {
  return new Set((await readdir(tmpdir())).filter((name) => name.startsWith("clawhub-clawpack-")));
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

function tarFile(path: string, content: string | Uint8Array) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
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

function npmPackFixture(files: Record<string, string | Uint8Array>) {
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
  it("validates a local plugin package with bundled Plugin Inspector offline", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "demo-plugin");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "package.json"), '{"name":"demo-plugin","version":"1.0.0"}\n');

      inspectorMocks.pluginRoot.runCheck.mockResolvedValueOnce({
        report: { status: "pass", summary: { breakageCount: 0 } },
        paths: { jsonPath: join(folder, "reports", "plugin-inspector-report.json") },
      });

      await cmdValidatePackage(makeOpts(workdir), "demo-plugin", {});

      expect(inspectorMocks.pluginRoot.runCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          allowExecution: false,
          capture: false,
          configPath: expect.stringContaining("plugin-inspector.config.json"),
          mockSdk: true,
          openclawPath: false,
          outDir: "reports",
          pluginRoot: folder,
          authorFacing: true,
        }),
      );
      expect(inspectorMocks.ci.writeOutputs).toHaveBeenCalledWith(
        { status: "pass", summary: { breakageCount: 0 } },
        { cwd: join(folder, "reports"), outDir: "." },
      );
      const output = mockLog.mock.calls.join("\n");
      expect(output).toContain("Plugin Inspector: PASS");
      expect(output).toContain("Findings: none");
      expect(output).toContain("Reports written:");
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("fails package validation when Plugin Inspector reports hard breakages", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "broken-plugin");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "package.json"), '{"name":"broken-plugin","version":"1.0.0"}\n');
      inspectorMocks.pluginRoot.runCheck.mockResolvedValueOnce({
        report: { status: "fail", summary: { breakageCount: 1 } },
        paths: { jsonPath: join(folder, "reports", "plugin-inspector-report.json") },
      });

      await expect(cmdValidatePackage(makeOpts(workdir), "broken-plugin", {})).rejects.toThrow(
        "Plugin Inspector found 1 hard error",
      );

      expect(mockLog.mock.calls.join("\n")).toContain("Plugin Inspector: FAIL");
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("fails package validation for legacy author-facing hard breakages without remediation metadata", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "legacy-broken-plugin");
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        '{"name":"legacy-broken-plugin","version":"1.0.0"}\n',
      );
      inspectorMocks.pluginRoot.runCheck.mockResolvedValueOnce({
        report: {
          status: "fail",
          summary: { breakageCount: 1, warningCount: 0, issueCount: 1 },
          issues: [
            {
              code: "package-entrypoint-missing",
              level: "breakage",
              message: "declared OpenClaw entrypoint does not exist",
            },
            {
              code: "runtime-tool-capture",
              level: "warning",
              message: "internal capture coverage gap",
            },
          ],
        },
        paths: { jsonPath: join(folder, "reports", "plugin-inspector-report.json") },
      });

      await expect(
        cmdValidatePackage(makeOpts(workdir), "legacy-broken-plugin", {}),
      ).rejects.toThrow("Plugin Inspector found 1 hard error");

      const output = mockLog.mock.calls.join("\n");
      expect(output).toContain("Plugin Inspector: FAIL");
      expect(output).toContain("ERROR package-entrypoint-missing");
      expect(output).toContain("Fix: Publish the entrypoint declared in OpenClaw package metadata");
      expect(output).not.toContain("runtime-tool-capture");
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("prints author-facing package validation findings before report paths by default", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "warning-plugin");
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        '{"name":"warning-plugin","version":"1.0.0"}\n',
      );
      inspectorMocks.pluginRoot.runCheck.mockResolvedValueOnce({
        report: {
          status: "pass",
          summary: {
            breakageCount: 0,
            warningCount: 2,
            issueCount: 2,
          },
          issues: [
            {
              code: "legacy-hook",
              level: "warning",
              issueClass: "deprecation-warning",
              severity: "P2",
              title: "legacy hook is deprecated",
              evidence: ["src/index.ts:4", { hook: "before_agent_start" }],
              authorRemediation: {
                summary: "Move the hook to before_prompt_build.",
                docsUrl: "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#legacy-hook",
              },
            },
            {
              code: "runtime-tool-capture",
              level: "warning",
              message: "internal capture coverage gap",
            },
          ],
        },
        paths: {
          jsonPath: join(folder, "reports", "plugin-inspector-report.json"),
          markdownPath: join(folder, "reports", "plugin-inspector-report.md"),
          issuesPath: join(folder, "reports", "plugin-inspector-issues.md"),
        },
      });

      await cmdValidatePackage(makeOpts(workdir), "warning-plugin", {});

      const output = mockLog.mock.calls.join("\n");
      expect(output).toContain("Plugin Inspector: PASS");
      expect(output).toContain("Breakages: 0");
      expect(output).toContain("Warnings: 1");
      expect(output).toContain("Findings:");
      expect(output).toContain(
        "WARNING legacy-hook (deprecation-warning) P2: legacy hook is deprecated",
      );
      expect(output).toContain("Fix: Move the hook to before_prompt_build.");
      expect(output).toContain(
        "Docs: https://docs.openclaw.ai/clawhub/plugin-validation-fixes#legacy-hook",
      );
      expect(output).toContain("Evidence:");
      expect(output).toContain("- src/index.ts:4");
      expect(output).not.toContain("runtime-tool-capture");
      expect(output).not.toContain("undefined");
      expect(output.trim()).toMatch(
        /Reports written: json=.*plugin-inspector-report\.json, markdown=.*plugin-inspector-report\.md, issues=.*plugin-inspector-issues\.md$/,
      );
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("prints package validation JSON from the sanitized Plugin Inspector report", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "warning-plugin");
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        '{"name":"warning-plugin","version":"1.0.0"}\n',
      );
      const report = {
        status: "pass",
        summary: {
          breakageCount: 0,
          warningCount: 4,
          issueCount: 4,
          inspectorGapCount: 1,
        },
        issues: [
          {
            code: "legacy-hook",
            level: "warning",
            message: "legacy hook is deprecated",
            authorRemediation: {
              summary: "Move the hook to before_prompt_build.",
              docsUrl: "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#legacy-hook",
            },
          },
          {
            code: "runtime-tool-capture",
            level: "warning",
            message: "runtime tools need capture before contract judgment",
          },
          {
            code: "package-plugin-api-compat-missing",
            level: "warning",
            message: "package.json is missing openclaw.compat.pluginApi",
          },
          {
            code: "sdk-session-store-write",
            level: "warning",
            issueClass: "deprecation-warning",
            message: "deprecated whole-store session write helper is still used",
          },
        ],
      };
      inspectorMocks.pluginRoot.runCheck.mockResolvedValueOnce({
        report,
        paths: { jsonPath: join(folder, "reports", "plugin-inspector-report.json") },
      });

      await cmdValidatePackage(makeOpts(workdir), "warning-plugin", { json: true });

      const stdoutReport = JSON.parse(String(mockWrite.mock.calls[0]?.[0]));
      expect(stdoutReport).toEqual({
        status: "pass",
        summary: {
          breakageCount: 0,
          warningCount: 3,
          deprecationWarningCount: 1,
          issueCount: 3,
        },
        issues: [
          {
            code: "legacy-hook",
            level: "warning",
            message: "legacy hook is deprecated",
            authorRemediation: {
              summary: "Move the hook to before_prompt_build.",
              docsUrl: "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#legacy-hook",
            },
          },
          {
            code: "package-plugin-api-compat-missing",
            level: "warning",
            message: "package.json is missing openclaw.compat.pluginApi",
            authorRemediation: {
              summary: "Declare the OpenClaw plugin API range this package supports.",
              docsUrl:
                "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#package-plugin-api-compat-missing",
            },
          },
          {
            code: "sdk-session-store-write",
            level: "warning",
            issueClass: "deprecation-warning",
            message: "deprecated whole-store session write helper is still used",
            authorRemediation: {
              summary:
                "Replace deprecated whole-store session writes with row-scoped session helpers.",
              docsUrl:
                "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#sdk-session-store-write",
            },
          },
        ],
      });
      expect(mockWrite.mock.calls.join("\n")).not.toContain("runtime-tool-capture");
      expect(mockWrite.mock.calls.join("\n")).not.toContain("inspectorGapCount");
      const artifactReport = await readFile(
        join(folder, "reports", "plugin-inspector-report.json"),
        "utf8",
      );
      expect(artifactReport).toContain("package-plugin-api-compat-missing");
      expect(artifactReport).toContain("sdk-session-store-write");
      expect(artifactReport).not.toContain("runtime-tool-capture");
      expect(artifactReport).not.toContain("inspectorGapCount");
      expect(mockLog).not.toHaveBeenCalled();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

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
    });

    const request = httpMocks.apiRequest.mock.calls[0]?.[1] as { url?: string } | undefined;
    const url = new URL(String(request?.url));
    expect(url.pathname).toBe("/api/v1/packages/search");
    expect(url.searchParams.get("q")).toBe("demo plugin");
    expect(url.searchParams.get("family")).toBe("code-plugin");
  });

  it("supports skill family package browse requests", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    });

    await cmdExplorePackages(makeOpts(), "", { family: "skill", limit: 7 });

    const request = httpMocks.apiRequest.mock.calls[0]?.[1] as { url?: string } | undefined;
    const url = new URL(String(request?.url));
    expect(url.pathname).toBe("/api/v1/packages");
    expect(url.searchParams.get("family")).toBe("skill");
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
    expect(url.searchParams.get("preview")).toBe("1");
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
        publicationStatus: "published",
      });

      const options = {
        owner: "@openclaw",
        sourceRepo: "openclaw/demo-plugin",
        sourceCommit: "abc123",
        sourceRef: "refs/tags/v1.0.0",
        categories: "tools, runtime",
        topics: "GitHub Actions, CI",
      } as Parameters<typeof cmdPublishPackage>[2];

      await cmdPublishPackage(makeOpts(workdir), "demo-plugin", options);

      expect(getPublishPayload()).toEqual({
        name: "@scope/demo-plugin",
        displayName: "Demo Plugin",
        ownerHandle: "openclaw",
        family: "code-plugin",
        version: "1.0.0",
        changelog: "",
        tags: ["latest"],
        categories: ["tools", "runtime"],
        topics: ["GitHub Actions", "CI"],
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
      expect(httpMocks.apiRequestForm.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({ retryCount: 5 }),
      );
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

  it("reports pending security checks for staged package publishes", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "pending-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "@scope/pending-plugin",
          displayName: "Pending Plugin",
          version: "1.0.0",
          files: ["dist", "openclaw.plugin.json"],
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "pending.plugin" }),
        "utf8",
      );
      await writeFile(join(folder, "dist", "index.js"), "export const demo = true;\n", "utf8");

      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_1",
        releaseId: "rel_1",
        publicationStatus: "pending",
        attemptId: "attempt_1",
      });

      await cmdPublishPackage(makeOpts(workdir), "pending-plugin", {
        owner: "@openclaw",
        sourceRepo: "openclaw/pending-plugin",
        sourceCommit: "abc123",
      });

      expect(uiMocks.spinner.succeed).toHaveBeenCalledWith(
        "Update submitted for @scope/pending-plugin@1.0.0; pending security scans before it becomes public.",
      );
      expect(mockWrite).not.toHaveBeenCalled();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("includes pending package publish metadata in json output", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "json-pending-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "@scope/json-pending-plugin",
          displayName: "JSON Pending Plugin",
          version: "1.0.0",
          files: ["dist", "openclaw.plugin.json"],
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "json.pending.plugin" }),
        "utf8",
      );
      await writeFile(join(folder, "dist", "index.js"), "export const demo = true;\n", "utf8");

      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_1",
        releaseId: "rel_1",
        publicationStatus: "pending",
        attemptId: "attempt_1",
      });

      await cmdPublishPackage(makeOpts(workdir), "json-pending-plugin", {
        owner: "@openclaw",
        sourceRepo: "openclaw/json-pending-plugin",
        sourceCommit: "abc123",
        json: true,
      });

      expect(uiMocks.spinner.succeed).not.toHaveBeenCalled();
      expect(mockWrite).toHaveBeenCalledTimes(1);
      const output = JSON.parse(String(mockWrite.mock.calls[0]?.[0] ?? ""));
      expect(output).toEqual(
        expect.objectContaining({
          name: "@scope/json-pending-plugin",
          status: "pending-publication",
          releaseId: "rel_1",
          publicationStatus: "pending",
          attemptId: "attempt_1",
        }),
      );
      expect(output.status).not.toBe("published");
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("does not claim a package was published when the server omits publication status", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "unknown-status-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "@scope/unknown-status-plugin",
          displayName: "Unknown Status Plugin",
          version: "1.0.0",
          files: ["dist", "openclaw.plugin.json"],
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "unknown.status.plugin" }),
        "utf8",
      );
      await writeFile(join(folder, "dist", "index.js"), "export const demo = true;\n", "utf8");
      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_1",
        releaseId: "rel_1",
      });

      await cmdPublishPackage(makeOpts(workdir), "unknown-status-plugin", {
        owner: "@openclaw",
        sourceRepo: "openclaw/unknown-status-plugin",
        sourceCommit: "abc123",
      });

      expect(uiMocks.spinner.succeed).toHaveBeenCalledWith(
        "Update submitted for @scope/unknown-status-plugin@1.0.0; publication status was not reported.",
      );
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("sends explicit empty catalog metadata to clear existing package values", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "clear-topics-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "@scope/clear-topics-plugin",
          version: "1.0.0",
          files: ["dist", "openclaw.plugin.json"],
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "clear.topics.plugin" }),
        "utf8",
      );
      await writeFile(join(folder, "dist", "index.js"), "export const demo = true;\n", "utf8");
      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_1",
        releaseId: "rel_1",
      });

      await cmdPublishPackage(makeOpts(workdir), "clear-topics-plugin", {
        sourceRepo: "openclaw/clear-topics-plugin",
        sourceCommit: "abc123",
        categories: "",
        topics: "",
      });

      expect(getPublishPayload()).toMatchObject({ categories: [], topics: [] });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("uses the README H1 as a package display name fallback", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "clawhub-github-publish-clh4hR");
      await mkdir(join(folder, "dist"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "@scope/demo-plugin",
          version: "1.0.0",
          files: ["dist", "openclaw.plugin.json", "README.md"],
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.plugin" }),
        "utf8",
      );
      await writeFile(
        join(folder, "README.md"),
        "---\nignored: true\n---\n\n# Honcho Memory Plugin for OpenClaw\n\nDetails.\n",
        "utf8",
      );
      await writeFile(join(folder, "dist", "index.js"), "export const demo = true;\n", "utf8");

      await cmdPublishPackage(makeOpts(workdir), "clawhub-github-publish-clh4hR", {
        dryRun: true,
        json: true,
        sourceRepo: "openclaw/demo-plugin",
        sourceCommit: "abc123",
      });

      const output = String(mockWrite.mock.calls[0]?.[0] ?? "").trim();
      expect(JSON.parse(output)).toMatchObject({
        displayName: "Honcho Memory Plugin for OpenClaw",
      });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("prefers the OpenClaw plugin manifest name over package.json displayName", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "demo-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "@scope/demo-plugin",
          displayName: "Package Display Name",
          version: "1.0.0",
          files: ["dist", "openclaw.plugin.json"],
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.plugin", name: "Manifest Display Name" }),
        "utf8",
      );
      await writeFile(join(folder, "dist", "index.js"), "export const demo = true;\n", "utf8");

      await cmdPublishPackage(makeOpts(workdir), "demo-plugin", {
        dryRun: true,
        json: true,
        sourceRepo: "openclaw/demo-plugin",
        sourceCommit: "abc123",
      });

      const output = String(mockWrite.mock.calls[0]?.[0] ?? "").trim();
      expect(JSON.parse(output)).toMatchObject({
        displayName: "Manifest Display Name",
      });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("preserves literal trailing hashes in README H1 display name fallbacks", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "language-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "@scope/language-plugin",
          version: "1.0.0",
          files: ["dist", "openclaw.plugin.json", "README.md"],
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "language.plugin" }),
        "utf8",
      );
      await writeFile(join(folder, "README.md"), "# C#\n\nDetails.\n", "utf8");
      await writeFile(join(folder, "dist", "index.js"), "export const demo = true;\n", "utf8");

      await cmdPublishPackage(makeOpts(workdir), "language-plugin", {
        dryRun: true,
        json: true,
        sourceRepo: "openclaw/language-plugin",
        sourceCommit: "abc123",
      });

      const output = String(mockWrite.mock.calls[0]?.[0] ?? "").trim();
      expect(JSON.parse(output)).toMatchObject({
        displayName: "C#",
      });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("resolves package publish dot paths from the caller cwd before the OpenClaw workdir", async () => {
    const workspace = await makeTmpWorkdir();
    const pluginRoot = await makeTmpWorkdir();
    const previousCwd = process.cwd();
    try {
      await mkdir(join(pluginRoot, "dist"), { recursive: true });
      await writeFile(
        join(pluginRoot, "package.json"),
        makeCodePluginPackageJson({
          name: "@scope/cwd-plugin",
          displayName: "Cwd Plugin",
          version: "1.0.0",
          files: ["dist", "openclaw.plugin.json"],
        }),
        "utf8",
      );
      await writeFile(
        join(pluginRoot, "openclaw.plugin.json"),
        JSON.stringify({ id: "cwd.plugin", configSchema: { type: "object" } }),
        "utf8",
      );
      await writeFile(join(pluginRoot, "dist", "index.js"), "export const demo = true;\n", "utf8");

      process.chdir(pluginRoot);

      await cmdPublishPackage(makeOpts(workspace), ".", {
        dryRun: true,
        sourceRepo: "openclaw/cwd-plugin",
        sourceCommit: "abc123",
      });

      const output = mockLog.mock.calls.map((call) => String(call[0])).join("\n");
      expect(output).toContain("Name:      @scope/cwd-plugin");
      expect(output).toContain("Files:     3");
    } finally {
      process.chdir(previousCwd);
      await rm(pluginRoot, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
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
        publicationStatus: "published",
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

  it("stages ClawPack tarballs over the multipart publish budget", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const packName = "oversized-plugin-1.0.0.tgz";
      const packBytes = npmPackFixture({
        "package/package.json": makeCodePluginPackageJson({
          name: "@scope/oversized-plugin",
          displayName: "Oversized Plugin",
          version: "1.0.0",
        }),
        "package/openclaw.plugin.json": JSON.stringify({ id: "oversized.plugin" }),
        "package/dist/index.js": "export const demo = true;\n",
        "package/dist/model.bin": randomBytes(24 * 1024 * 1024),
      });
      expect(packBytes.byteLength).toBeGreaterThan(18 * 1024 * 1024);
      await writeFile(join(workdir, packName), packBytes);
      httpMocks.apiRequest.mockResolvedValueOnce({
        uploadUrl: "https://upload.local",
        uploadTicket: "uploadTickets:clawpack",
      });
      httpMocks.uploadBinary.mockResolvedValueOnce({ storageId: "storage:clawpack" });
      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_1",
        releaseId: "rel_1",
      });

      await cmdPublishPackage(makeOpts(workdir), packName, {
        sourceRepo: "openclaw/oversized-plugin",
        sourceCommit: "abc123",
      });

      expect(httpMocks.apiRequest).toHaveBeenCalledWith(
        "https://clawhub.ai",
        {
          method: "POST",
          path: "/api/cli/upload-url",
          token: "tkn",
        },
        expect.anything(),
      );
      expect(httpMocks.uploadBinary).toHaveBeenCalledWith(
        {
          url: "https://upload.local",
          bytes: expect.any(Uint8Array),
          contentType: "application/octet-stream",
          retryCount: 5,
        },
        expect.anything(),
      );
      expect(getPublishForm().get("clawpack")).toBe("storage:clawpack");
      expect(getPublishForm().get("clawpackUploadTicket")).toBe("uploadTickets:clawpack");
      expect(getPublishPayload()).not.toHaveProperty("artifact");
      expect(getPublishPayload()).not.toHaveProperty("files");
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

  it("packs local ClawPacks over the multipart publish upload budget", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "demo-heavy-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
      await mkdir(join(workdir, "packs"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "demo-heavy-plugin",
          displayName: "Demo Heavy Plugin",
          version: "1.0.0",
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.heavy.plugin" }),
        "utf8",
      );
      await writeFile(join(folder, "dist", "index.js"), "export const demo = true;\n", "utf8");
      await writeFile(join(folder, "dist", "model.bin"), randomBytes(24 * 1024 * 1024));

      await cmdPackPackage(makeOpts(workdir), "demo-heavy-plugin", {
        packDestination: "packs",
      });

      const packPath = join(workdir, "packs", "demo-heavy-plugin-1.0.0.tgz");
      const packed = await readFile(packPath);
      expect(packed.byteLength).toBeGreaterThan(18 * 1024 * 1024);
      expect(parseClawPack(new Uint8Array(packed)).packageName).toBe("demo-heavy-plugin");
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("cleans generated ClawPack temp dirs after staged publish failure", async () => {
    const workdir = await makeTmpWorkdir();
    const beforeTempDirs = await listClawPackTempDirs();
    try {
      const folder = join(workdir, "demo-heavy-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "demo-heavy-plugin",
          displayName: "Demo Heavy Plugin",
          version: "1.0.0",
          repository: "https://github.com/openclaw/demo-heavy-plugin.git",
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "demo.heavy.plugin" }),
        "utf8",
      );
      await writeFile(join(folder, "dist", "index.js"), "export const demo = true;\n", "utf8");
      await writeFile(join(folder, "dist", "model.bin"), randomBytes(24 * 1024 * 1024));
      httpMocks.apiRequest.mockResolvedValueOnce({
        uploadUrl: "https://upload.local",
        uploadTicket: "uploadTickets:clawpack",
      });
      httpMocks.uploadBinary.mockResolvedValueOnce({ storageId: "storage:clawpack" });
      httpMocks.apiRequestForm.mockRejectedValueOnce(new Error("Registry rejected upload"));

      await expect(
        cmdPublishPackage(makeOpts(workdir), "demo-heavy-plugin", {
          sourceRepo: "openclaw/demo-heavy-plugin",
          sourceCommit: "abc123",
        }),
      ).rejects.toThrow("Registry rejected upload");
      expect(getPublishForm().get("clawpack")).toBe("storage:clawpack");
      expect(getPublishForm().get("clawpackUploadTicket")).toBe("uploadTickets:clawpack");

      const afterTempDirs = await listClawPackTempDirs();
      expect([...afterTempDirs].filter((name) => !beforeTempDirs.has(name))).toEqual([]);
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

  it("explains missing declared runtime extension files", async () => {
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
              runtimeExtensions: ["./dist/index.js"],
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
          sourceRef: "refs/tags/v1.0.0",
        }),
      ).rejects.toThrow(
        "@scope/demo-plugin declares openclaw.runtimeExtensions entry ./dist/index.js, but that file is missing from the package. Build first and publish a local folder or .tgz, or include the runtime file in the GitHub ref.",
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

  it("prefers openclaw.plugin.json over skills markers when detecting package family", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "demo-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
      await mkdir(join(folder, "skills", "demo"), { recursive: true });
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
      await writeFile(join(folder, "skills", "demo", "SKILL.md"), "---\nname: demo\n---\n", "utf8");
      await writeFile(join(folder, "dist", "index.js"), "export default {};\n", "utf8");

      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_code",
        releaseId: "rel_code",
      });

      await cmdPublishPackage(makeOpts(workdir), "demo-plugin", {
        sourceRepo: "openclaw/demo-plugin",
        sourceCommit: "abc123",
      });

      expect(getPublishPayload()).toMatchObject({
        name: "demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        version: "1.0.0",
      });
      expect(getUploadedClawPackNames()).toEqual(["demo-plugin-1.0.0.tgz"]);
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

  it("fails CLI publish on server Plugin Inspector hard errors", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "broken-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
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
      );
      await writeFile(join(folder, "dist", "index.js"), "export const demo = true;\n", "utf8");

      httpMocks.apiRequestForm.mockRejectedValueOnce(
        new Error(
          "Plugin Inspector blocked publish: missing-expected-seam: missing expected registration registerTool",
        ),
      );

      await expect(
        cmdPublishPackage(makeOpts(workdir), "broken-plugin", {
          sourceRepo: "openclaw/broken-plugin",
          sourceCommit: "deadbeef",
        }),
      ).rejects.toThrow("Plugin Inspector blocked publish");

      expect(uiMocks.spinner.fail).toHaveBeenCalledWith(
        "Plugin Inspector blocked publish: missing-expected-seam: missing expected registration registerTool",
      );
      expect(uiMocks.spinner.succeed).not.toHaveBeenCalled();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("prints Plugin Inspector warnings for successful CLI publishes", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "warning-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        makeCodePluginPackageJson({
          name: "warning-plugin",
          displayName: "Warning Plugin",
          version: "1.0.0",
        }),
        "utf8",
      );
      await writeFile(
        join(folder, "openclaw.plugin.json"),
        JSON.stringify({ id: "warning.plugin" }),
      );
      await writeFile(join(folder, "dist", "index.js"), "export const demo = true;\n", "utf8");

      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        packageId: "pkg_1",
        releaseId: "rel_1",
        publicationStatus: "published",
        inspectorFindings: [
          {
            findingKind: "warning",
            code: "legacy-before-agent-start",
            issueClass: "deprecation-warning",
            message: "legacy before_agent_start hook is deprecated",
            authorRemediation: {
              summary: "Replace the legacy before_agent_start hook with current prompt hooks.",
              docsUrl:
                "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#legacy-before-agent-start",
            },
          },
        ],
      });

      await cmdPublishPackage(makeOpts(workdir), "warning-plugin", {
        sourceRepo: "openclaw/warning-plugin",
        sourceCommit: "abc123",
      });

      expect(uiMocks.spinner.succeed).toHaveBeenCalledWith(
        "OK. Published warning-plugin@1.0.0 (rel_1)",
      );
      expect(mockLog).toHaveBeenCalledWith("Plugin Inspector findings: 1 warning");
      expect(mockLog).toHaveBeenCalledWith(
        "- WARNING legacy-before-agent-start (deprecation-warning): legacy before_agent_start hook is deprecated",
      );
      expect(mockLog).toHaveBeenCalledWith(
        "  Fix: Replace the legacy before_agent_start hook with current prompt hooks.",
      );
      expect(mockLog).toHaveBeenCalledWith(
        "  Docs: https://docs.openclaw.ai/clawhub/plugin-validation-fixes#legacy-before-agent-start",
      );
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

  it("owns trusted publisher set and delete commands in the public package CLI", async () => {
    const testSource = await readFile(new URL("./packages.test.ts", import.meta.url), "utf8");
    const cliSource = await readFile(new URL("../../cli.ts", import.meta.url), "utf8");
    const modImportPrefix = testSource.split(
      '} = await import("../../../../clawhub-mod/src/commands/packages");',
    )[0];
    const modImportBlock = modImportPrefix ? (modImportPrefix.split("const {").at(-1) ?? "") : "";

    expect(modImportBlock).not.toEqual("");
    expect(modImportBlock).not.toContain("cmdSetPackageTrustedPublisher");
    expect(modImportBlock).not.toContain("cmdDeletePackageTrustedPublisher");
    expect(cliSource).toContain('["package", "trusted-publisher", "set"]');
    expect(cliSource).toContain('["package", "trusted-publisher", "delete"]');
    expect(cliSource).toContain("cmdSetPackageTrustedPublisher(opts, name, options)");
    expect(cliSource).toContain("cmdDeletePackageTrustedPublisher(opts, name, options)");
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
    expect(mockLog).toHaveBeenCalledWith("Trusted publisher saved for @openclaw/zalo.");
    expect(mockLog).toHaveBeenCalledWith("Provider: github-actions");
    expect(mockLog).toHaveBeenCalledWith("Repository: openclaw/openclaw");
    expect(mockLog).toHaveBeenCalledWith("Workflow: plugin-clawhub-release.yml");
    expect(mockLog).toHaveBeenCalledWith("Environment: clawhub-release");
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
      expect.anything(),
    );
    expect(mockLog).toHaveBeenCalledWith("Trusted publisher deleted for @openclaw/zalo.");
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

  it("deletes one package version through the existing endpoint and preserves JSON output", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true });

    await cmdDeletePackage(
      makeOpts(),
      "@openclaw/zalo",
      { yes: true, version: " 1.2.3 ", json: true },
      false,
    );

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "DELETE",
        path: "/api/v1/packages/%40openclaw%2Fzalo/versions/1.2.3",
        token: "tkn",
        body: { version: "1.2.3" },
        retryCount: 0,
      }),
      expect.anything(),
    );
    expect(mockLog).toHaveBeenCalledWith(JSON.stringify({ ok: true }, null, 2));
  });

  it("keeps whole-package delete requests unchanged without --version", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true });

    await cmdDeletePackage(makeOpts(), "@openclaw/zalo", { yes: true }, false);

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "DELETE",
        path: "/api/v1/packages/%40openclaw%2Fzalo",
        token: "tkn",
      }),
      expect.anything(),
    );
    expect(httpMocks.apiRequest.mock.calls[0]?.[1]).not.toHaveProperty("body");
    expect(httpMocks.apiRequest.mock.calls[0]?.[1]).not.toHaveProperty("retryCount");
  });

  it("confirms that package version deletion is a reversible withdrawal", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true });

    await cmdDeletePackage(makeOpts(), "@openclaw/zalo", { version: "1.2.3" }, true);

    expect(uiMocks.promptConfirm).toHaveBeenCalledWith(expect.stringContaining("version 1.2.3"));
    expect(uiMocks.promptConfirm).toHaveBeenCalledWith(
      expect.stringContaining("exact retained artifact can be restored"),
    );
    expect(uiMocks.promptConfirm).toHaveBeenCalledWith(
      expect.stringContaining("version number remains reserved"),
    );
    expect(uiMocks.promptConfirm).toHaveBeenCalledWith(
      expect.stringContaining("publish a replacement first"),
    );
  });

  it("rejects an empty package version", async () => {
    await expect(
      cmdDeletePackage(makeOpts(), "@openclaw/zalo", { yes: true, version: "   " }, false),
    ).rejects.toThrow(/version.*empty/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("transfers a package to another publisher", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      packageId: "packages:opik",
      name: "@opik/opik-openclaw",
      ownerUserId: "users:vincent",
      ownerPublisherId: "publishers:opik",
      channel: "community",
      isOfficial: false,
    });

    await cmdTransferPackage(makeOpts(), "@opik/opik-openclaw", { to: "opik" });

    expect(authTokenMocks.requireAuthToken).toHaveBeenCalled();
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/packages/%40opik%2Fopik-openclaw/transfer",
        token: "tkn",
        body: { toOwner: "opik" },
      }),
      expect.anything(),
    );
  });

  it("requires --yes for non-interactive package deletes", async () => {
    await expect(cmdDeletePackage(makeOpts(), "@openclaw/zalo", {}, false)).rejects.toThrow(
      /--yes/i,
    );
    await expect(
      cmdDeletePackage(makeOpts(), "@openclaw/zalo", { version: "1.2.3" }, false),
    ).rejects.toThrow(/--yes/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("restores package deletes through the undelete endpoint", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true });

    await cmdUndeletePackage(makeOpts(), "@openclaw/zalo", { yes: true }, false);

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/packages/%40openclaw%2Fzalo/undelete",
        token: "tkn",
      }),
      expect.anything(),
    );
  });

  it("restores an owner-withdrawn package release without retrying", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({ ok: true });

    await cmdUndeletePackage(
      makeOpts(),
      "@openclaw/zalo",
      { yes: true, version: " 1.2.3 " },
      false,
    );

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/packages/%40openclaw%2Fzalo/versions/1.2.3/restore",
        token: "tkn",
        retryCount: 0,
      }),
      expect.anything(),
    );
  });
});
