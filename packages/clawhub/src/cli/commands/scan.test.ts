/* @vitest-environment node */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthTokenModuleMocks,
  createHttpModuleMocks,
  createRegistryModuleMocks,
  createUiModuleMocks,
  makeGlobalOpts,
} from "../../../test/cliCommandTestKit.js";
import { ApiRoutes } from "../../schema/index.js";

const authTokenMocks = createAuthTokenModuleMocks();
const registryMocks = createRegistryModuleMocks();
const httpMocks = createHttpModuleMocks();
const uiMocks = createUiModuleMocks();

vi.mock("../authToken.js", () => authTokenMocks.moduleFactory());
vi.mock("../registry.js", () => registryMocks.moduleFactory());
vi.mock("../../http.js", () => httpMocks.moduleFactory());
vi.mock("../ui.js", () => uiMocks.moduleFactory());

const { cmdScan, cmdScanDownload } = await import("./scan");

const mockLog = vi.spyOn(console, "log").mockImplementation(() => {});
const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

async function makeTmpWorkdir() {
  return await mkdtemp(join(tmpdir(), "clawhub-scan-"));
}

function completedScan(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    scanId: "scan_123",
    jobId: "job_123",
    status: "succeeded",
    sourceKind: "published",
    update: false,
    writtenBack: false,
    artifact: {
      slug: "demo",
      displayName: "Demo",
      version: "1.2.3",
    },
    report: {
      clawscan: {
        status: "clean",
        verdict: "clean",
        confidence: "high",
        summary: "No suspicious behavior found.",
        guidance: "OK to publish.",
        findings: "No findings.",
        checkedAt: 1_700_000_000_000,
      },
      skillspector: {
        status: "clean",
        score: 100,
        severity: "none",
        issueCount: 0,
        issues: [],
        checkedAt: 1_700_000_000_000,
      },
      staticAnalysis: {
        status: "clean",
        reasonCodes: [],
        findings: [],
        summary: "Static checks passed.",
        checkedAt: 1_700_000_000_000,
      },
      virustotal: null,
    },
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    completedAt: 1_700_000_100_000,
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  mockLog.mockClear();
  mockWrite.mockClear();
  process.exitCode = undefined;
});

describe("cmdScan", () => {
  it("rejects local folder scans because stored submitted-version reports are canonical", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "local-skill");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Local Skill\n", "utf8");
      await writeFile(join(folder, "notes.md"), "notes\n", "utf8");

      await expect(cmdScan(makeGlobalOpts(workdir), "local-skill", {})).rejects.toThrow(
        "Local folder scans are no longer supported",
      );
      expect(authTokenMocks.requireAuthToken).not.toHaveBeenCalled();
      expect(registryMocks.getRegistry).not.toHaveBeenCalled();
      expect(httpMocks.apiRequestForm).not.toHaveBeenCalled();
      expect(httpMocks.apiRequest).not.toHaveBeenCalled();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("submits a published scan with update mode", async () => {
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        ok: true,
        scanId: "scan_123",
        jobId: "job_123",
        status: "queued",
        sourceKind: "published",
        update: true,
      })
      .mockResolvedValueOnce(completedScan({ update: true, writtenBack: true }));

    await cmdScan(makeGlobalOpts(), undefined, {
      slug: "demo",
      version: "1.2.3",
      update: true,
    });

    expect(httpMocks.apiRequest.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      path: ApiRoutes.skillScans,
      token: "tkn",
      body: {
        source: { kind: "published", slug: "demo", version: "1.2.3" },
        update: true,
      },
    });
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining("Written back: yes"));
  });

  it("downloads the canonical report zip when --output is set", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const output = join(workdir, "report.zip");
      httpMocks.apiRequest
        .mockResolvedValueOnce({
          ok: true,
          scanId: "scan_123",
          jobId: "job_123",
          status: "queued",
          sourceKind: "published",
          update: false,
        })
        .mockResolvedValueOnce(completedScan());
      httpMocks.fetchBinary.mockResolvedValueOnce(new Uint8Array([80, 75, 3, 4]));

      await cmdScan(makeGlobalOpts(workdir), undefined, { slug: "demo", output });

      expect(httpMocks.fetchBinary).toHaveBeenCalledWith("https://clawhub.ai", {
        path: `${ApiRoutes.skillScans}/scan_123/download`,
        token: "tkn",
      });
      expect(await readFile(output)).toEqual(Buffer.from([80, 75, 3, 4]));
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("rejects ambiguous or invalid source options", async () => {
    await expect(cmdScan(makeGlobalOpts(), "local-skill", { slug: "demo" })).rejects.toThrow(
      "Choose either a local path or --slug, not both",
    );
    await expect(cmdScan(makeGlobalOpts(), "local-skill", { update: true })).rejects.toThrow(
      "--update is only valid with --slug",
    );
    await expect(cmdScan(makeGlobalOpts(), undefined, {})).rejects.toThrow(
      "Provide a local path or --slug",
    );
  });
});

describe("cmdScanDownload", () => {
  it("downloads stored scan results for a submitted skill version", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      httpMocks.fetchBinary.mockResolvedValueOnce(new Uint8Array([80, 75, 3, 4]));

      await cmdScanDownload(makeGlobalOpts(workdir), "demo-skill", {
        version: "1.2.3",
        output: "scan.zip",
      });

      expect(httpMocks.fetchBinary).toHaveBeenCalledWith("https://clawhub.ai", {
        path: `${ApiRoutes.skillScans}/download/demo-skill?version=1.2.3&kind=skill`,
        token: "tkn",
      });
      expect(await readFile(join(workdir, "scan.zip"))).toEqual(Buffer.from([80, 75, 3, 4]));
      expect(mockLog).toHaveBeenCalledWith(`Report ZIP: ${join(workdir, "scan.zip")}`);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("requires a version because rejected versions must be addressed explicitly", async () => {
    await expect(cmdScanDownload(makeGlobalOpts(), "demo-skill", {})).rejects.toThrow(
      "--version required",
    );
  });

  it("sanitizes the version in the default report filename", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      httpMocks.fetchBinary.mockResolvedValueOnce(new Uint8Array([80, 75, 3, 4]));

      await cmdScanDownload(makeGlobalOpts(workdir), "demo-skill", {
        version: "../../evil",
      });

      expect(httpMocks.fetchBinary).toHaveBeenCalledWith("https://clawhub.ai", {
        path: `${ApiRoutes.skillScans}/download/demo-skill?version=..%2F..%2Fevil&kind=skill`,
        token: "tkn",
      });
      expect(await readFile(join(workdir, "clawhub-scan-demo-skill-..-..-evil.zip"))).toEqual(
        Buffer.from([80, 75, 3, 4]),
      );
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("supports plugin scan report downloads with an explicit kind", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      httpMocks.fetchBinary.mockResolvedValueOnce(new Uint8Array([80, 75, 3, 4]));

      await cmdScanDownload(makeGlobalOpts(workdir), "@scope/demo", {
        kind: "plugin",
        version: "2.0.0",
        output: "plugin-scan.zip",
      });

      expect(httpMocks.fetchBinary).toHaveBeenCalledWith("https://clawhub.ai", {
        path: `${ApiRoutes.skillScans}/download/%40scope%2Fdemo?version=2.0.0&kind=plugin`,
        token: "tkn",
      });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });
});
