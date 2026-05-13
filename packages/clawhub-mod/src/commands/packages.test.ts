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
  cmdExportPackageDryRunScanResults,
  cmdPackageDryRunScanStatus,
  cmdStartPackageDryRunScan,
  cmdWatchPackageDryRunScan,
} = await import("./packages");

const mockLog = vi.spyOn(console, "log").mockImplementation(() => {});
const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

afterEach(() => {
  vi.useRealTimers();
  httpMocks.apiRequest.mockReset();
  vi.clearAllMocks();
});

describe("package dry-run scan commands", () => {
  it("starts a dry-run scan for explicit release ids with JSON output", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      jobId: "packageDryRunScanJobs:1",
      status: "queued",
      totalItems: 1,
      targetSelectionDone: true,
    });

    await cmdStartPackageDryRunScan(makeGlobalOpts(), {
      releaseId: ["packageReleases:demo"],
      json: true,
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      {
        method: "POST",
        path: "/api/v1/packages/-/dry-run-scans",
        token: "tkn",
        body: {
          selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
        },
      },
      expect.anything(),
    );
    expect(mockWrite).toHaveBeenCalledWith(
      `${JSON.stringify(
        {
          jobId: "packageDryRunScanJobs:1",
          status: "queued",
          totalItems: 1,
          targetSelectionDone: true,
        },
        null,
        2,
      )}\n`,
    );
  });

  it("starts a dry-run scan for explicit package names", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      jobId: "packageDryRunScanJobs:1",
      status: "queued",
      totalItems: 1,
      targetSelectionDone: true,
    });

    await cmdStartPackageDryRunScan(makeGlobalOpts(), {
      package: ["demo-plugin"],
      json: true,
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/packages/-/dry-run-scans",
        token: "tkn",
        body: {
          selector: { kind: "packageNames", packageNames: ["demo-plugin"] },
        },
      }),
      expect.anything(),
    );
  });

  it("prints pending target selection for all-active dry-run scans", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      jobId: "packageDryRunScanJobs:1",
      status: "queued",
      totalItems: 0,
      targetSelectionDone: false,
    });

    await cmdStartPackageDryRunScan(makeGlobalOpts(), {
      allActive: true,
    });

    expect(mockLog).toHaveBeenCalledWith(
      "Started dry-run scan packageDryRunScanJobs:1: queued, target selection pending.",
    );
  });

  it("prints candidate-limit warnings when starting dry-run scans", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      jobId: "packageDryRunScanJobs:1",
      status: "queued",
      totalItems: 1,
      targetSelectionDone: true,
      candidateLimitReached: true,
    });

    await cmdStartPackageDryRunScan(makeGlobalOpts(), {
      seed: "fs-safe-v1",
    });

    expect(mockLog).toHaveBeenCalledWith(
      "Started dry-run scan packageDryRunScanJobs:1: queued, 1 items.",
    );
    expect(mockLog).toHaveBeenCalledWith(
      "Warning: maxCandidates was reached before the full candidate set.",
    );
  });

  it("rejects invalid dry-run scan numeric options", async () => {
    await expect(
      cmdStartPackageDryRunScan(makeGlobalOpts(), {
        seed: "fs-safe-v1",
        limit: Number.NaN,
      }),
    ).rejects.toThrow("--limit must be a positive integer");
    await expect(
      cmdStartPackageDryRunScan(makeGlobalOpts(), {
        seed: "fs-safe-v1",
        maxCandidates: 0,
      }),
    ).rejects.toThrow("--max-candidates must be a positive integer");
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("rejects dry-run scan numeric options above API limits", async () => {
    await expect(
      cmdStartPackageDryRunScan(makeGlobalOpts(), {
        latestActive: true,
        limit: 201,
      }),
    ).rejects.toThrow("--limit must be at most 200");
    await expect(
      cmdStartPackageDryRunScan(makeGlobalOpts(), {
        seed: "fs-safe-v1",
        maxCandidates: 1_001,
      }),
    ).rejects.toThrow("--max-candidates must be at most 1000");
    await expect(
      cmdStartPackageDryRunScan(makeGlobalOpts(), {
        seed: "fs-safe-v1",
        limit: 20,
        maxCandidates: 10,
      }),
    ).rejects.toThrow("--max-candidates must be greater than or equal to --limit");
    await expect(
      cmdStartPackageDryRunScan(makeGlobalOpts(), {
        seed: "x".repeat(129),
      }),
    ).rejects.toThrow("--seed is limited to 128 characters");
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("rejects dry-run scan explicit selectors above API limits", async () => {
    await expect(
      cmdStartPackageDryRunScan(makeGlobalOpts(), {
        releaseId: Array.from({ length: 201 }, (_, index) => `packageReleases:${index}`),
      }),
    ).rejects.toThrow("--release-id is limited to 200 releases");
    await expect(
      cmdStartPackageDryRunScan(makeGlobalOpts(), {
        package: Array.from({ length: 201 }, (_, index) => `plugin-${index}`),
      }),
    ).rejects.toThrow("--package is limited to 200 packages");
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("rejects blank dry-run scan explicit selectors", async () => {
    await expect(
      cmdStartPackageDryRunScan(makeGlobalOpts(), {
        releaseId: ["   "],
      }),
    ).rejects.toThrow("--release-id cannot be blank");
    await expect(
      cmdStartPackageDryRunScan(makeGlobalOpts(), {
        package: ["   "],
      }),
    ).rejects.toThrow("--package cannot be blank");
    await expect(
      cmdStartPackageDryRunScan(makeGlobalOpts(), {
        seed: "   ",
      }),
    ).rejects.toThrow("--seed cannot be blank");
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("rejects dry-run scan sizing options that do not apply to the selected mode", async () => {
    await expect(
      cmdStartPackageDryRunScan(makeGlobalOpts(), {
        allActive: true,
        limit: 10,
      }),
    ).rejects.toThrow("--limit can only be used with --latest-active or --seed");
    await expect(
      cmdStartPackageDryRunScan(makeGlobalOpts(), {
        latestActive: true,
        maxCandidates: 50,
      }),
    ).rejects.toThrow("--max-candidates can only be used with --seed");
    await expect(
      cmdStartPackageDryRunScan(makeGlobalOpts(), {
        releaseId: ["packageReleases:demo"],
        maxCandidates: 50,
      }),
    ).rejects.toThrow("--max-candidates can only be used with --seed");
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("reads dry-run scan status with JSON output", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      jobId: "packageDryRunScanJobs:1",
      scanner: "filesystem-safety-v1",
      selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
      status: "completed",
      totalItems: 1,
      queuedItems: 0,
      runningItems: 0,
      completedItems: 1,
      failedItems: 0,
      skippedItems: 0,
      matchedItems: 0,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_100,
    });

    await cmdPackageDryRunScanStatus(makeGlobalOpts(), "packageDryRunScanJobs:1", { json: true });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      {
        method: "GET",
        path: "/api/v1/packages/-/dry-run-scans/packageDryRunScanJobs%3A1",
        token: "tkn",
      },
      expect.anything(),
    );
    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('"status": "completed"'));
  });

  it("prints matched item count in human-readable dry-run scan status", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ...makeDryRunScanJob("completed"),
      jobId: "packageDryRunScanJobs:1\n\u001b[31m",
      matchedItems: 2,
      error: "worker failed\n\u001b[31mboom\u202e",
    });

    await cmdPackageDryRunScanStatus(makeGlobalOpts(), "packageDryRunScanJobs:1", {});

    expect(mockLog).toHaveBeenCalledWith(
      "Dry-run scan packageDryRunScanJobs:1\\n\\x1b[31m: completed",
    );
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining("matched:2"));
    expect(mockLog).toHaveBeenCalledWith("  error: worker failed\\n\\x1b[31mboom\\u202e");
  });

  it("watches dry-run scan status until completion", async () => {
    vi.useFakeTimers();
    httpMocks.apiRequest
      .mockResolvedValueOnce(makeDryRunScanJob("running"))
      .mockResolvedValueOnce(makeDryRunScanJob("completed"));

    const watch = cmdWatchPackageDryRunScan(makeGlobalOpts(), "packageDryRunScanJobs:1", {
      intervalMs: 10,
      maxAttempts: 3,
      json: true,
    });

    await vi.waitFor(() => expect(httpMocks.apiRequest).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10);
    await watch;

    expect(httpMocks.apiRequest).toHaveBeenCalledTimes(2);
    expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
      2,
      "https://clawhub.ai",
      {
        method: "GET",
        path: "/api/v1/packages/-/dry-run-scans/packageDryRunScanJobs%3A1",
        token: "tkn",
      },
      expect.anything(),
    );
    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('"status": "completed"'));
  });

  it("stops watching when a dry-run scan fails", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce(makeDryRunScanJob("failed"));

    await cmdWatchPackageDryRunScan(makeGlobalOpts(), "packageDryRunScanJobs:1", {
      intervalMs: 10,
      maxAttempts: 3,
      json: true,
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('"status": "failed"'));
  });

  it("bounds dry-run scan watch polling attempts", async () => {
    vi.useFakeTimers();
    httpMocks.apiRequest
      .mockResolvedValueOnce(makeDryRunScanJob("running"))
      .mockResolvedValueOnce(makeDryRunScanJob("running"));

    const watch = cmdWatchPackageDryRunScan(makeGlobalOpts(), "packageDryRunScanJobs:1", {
      intervalMs: 10,
      maxAttempts: 2,
    });
    const watchError = expect(watch).rejects.toThrow(
      "Dry-run scan watch timed out after 2 status checks",
    );

    await vi.waitFor(() => expect(httpMocks.apiRequest).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10);
    await watchError;
    expect(httpMocks.apiRequest).toHaveBeenCalledTimes(2);
  });

  it("marks watch summaries with pending target selection", async () => {
    vi.useFakeTimers();
    httpMocks.apiRequest.mockResolvedValueOnce({
      ...makeDryRunScanJob("running"),
      jobId: "packageDryRunScanJobs:1\n\u001b[31m",
      totalItems: 0,
      runningItems: 0,
      targetSelectionDone: false,
    });

    const watch = cmdWatchPackageDryRunScan(makeGlobalOpts(), "packageDryRunScanJobs:1", {
      intervalMs: 10,
      maxAttempts: 1,
    });
    const watchError = expect(watch).rejects.toThrow(
      "Dry-run scan watch timed out after 1 status checks",
    );

    await vi.waitFor(() => expect(httpMocks.apiRequest).toHaveBeenCalledTimes(1));
    await watchError;

    expect(uiMocks.spinner.text).toContain("target selection pending");
    expect(uiMocks.spinner.text).toContain("packageDryRunScanJobs:1\\n\\x1b[31m");
  });

  it("exports dry-run scan results as JSONL", async () => {
    httpMocks.apiRequest
      .mockResolvedValueOnce(makeDryRunScanJob("completed"))
      .mockResolvedValueOnce({
        jobStatus: "completed",
        jobDone: true,
        partial: false,
        items: [
          {
            itemId: "packageDryRunScanResults:1",
            jobId: "packageDryRunScanJobs:1",
            releaseId: "packageReleases:demo",
            packageId: "packages:demo",
            packageName: "demo-plugin",
            packageDisplayName: "Demo Plugin",
            version: "1.0.0",
            status: "completed",
            rawFsUsageCount: 0,
            fsSafeUsageCount: 0,
            findings: [],
            errors: [],
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_100,
          },
        ],
        nextCursor: "cursor-2",
        done: false,
      })
      .mockResolvedValueOnce({
        jobStatus: "completed",
        jobDone: true,
        partial: false,
        items: [],
        nextCursor: null,
        done: true,
      });

    await cmdExportPackageDryRunScanResults(makeGlobalOpts(), "packageDryRunScanJobs:1", {
      jsonl: true,
      limit: 1,
    });

    expect(httpMocks.apiRequest).toHaveBeenNthCalledWith(
      2,
      "https://clawhub.ai",
      expect.objectContaining({
        method: "GET",
        token: "tkn",
        url: expect.stringContaining(
          "/api/v1/packages/-/dry-run-scans/packageDryRunScanJobs%3A1/results?",
        ),
      }),
      expect.anything(),
    );
    expect(mockWrite).toHaveBeenCalledWith(
      `${JSON.stringify({
        itemId: "packageDryRunScanResults:1",
        jobId: "packageDryRunScanJobs:1",
        releaseId: "packageReleases:demo",
        packageId: "packages:demo",
        packageName: "demo-plugin",
        packageDisplayName: "Demo Plugin",
        version: "1.0.0",
        status: "completed",
        rawFsUsageCount: 0,
        fsSafeUsageCount: 0,
        findings: [],
        errors: [],
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_100,
      })}\n`,
    );
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("escapes bidi controls in JSONL dry-run scan exports", async () => {
    const item = {
      itemId: "packageDryRunScanResults:1",
      jobId: "packageDryRunScanJobs:1",
      releaseId: "packageReleases:demo",
      packageId: "packages:demo",
      packageName: "demo\u202e-plugin",
      packageDisplayName: "Demo Plugin",
      version: "1.0.0",
      status: "completed",
      rawFsUsageCount: 1,
      fsSafeUsageCount: 0,
      findings: [
        {
          code: "raw-fs-usage",
          severity: "medium",
          file: "src/index.ts",
          line: 12,
          message: "Raw filesystem API usage detected",
          evidence: "fs.readFileSync(path)\u202e",
          evidenceTruncated: false,
        },
      ],
      errors: [],
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_100,
    };
    httpMocks.apiRequest
      .mockResolvedValueOnce(makeDryRunScanJob("completed"))
      .mockResolvedValueOnce({
        jobStatus: "completed",
        jobDone: true,
        partial: false,
        items: [item],
        nextCursor: null,
        done: true,
      });

    await cmdExportPackageDryRunScanResults(makeGlobalOpts(), "packageDryRunScanJobs:1", {
      jsonl: true,
    });

    const output = mockWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("demo\\u202e-plugin");
    expect(output).toContain("fs.readFileSync(path)\\u202e");
    expect(JSON.parse(output)).toEqual(item);
  });

  it("exports dry-run scan results as JSON when they fit in one page", async () => {
    const item = {
      itemId: "packageDryRunScanResults:1",
      jobId: "packageDryRunScanJobs:1",
      releaseId: "packageReleases:demo",
      packageId: "packages:demo",
      packageName: "demo-plugin",
      packageDisplayName: "Demo Plugin",
      version: "1.0.0",
      status: "completed",
      rawFsUsageCount: 1,
      fsSafeUsageCount: 0,
      findings: [],
      errors: [],
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_100,
    };
    httpMocks.apiRequest
      .mockResolvedValueOnce(makeDryRunScanJob("completed"))
      .mockResolvedValueOnce({
        jobStatus: "completed",
        jobDone: true,
        partial: false,
        items: [item],
        nextCursor: null,
        done: true,
      });

    await cmdExportPackageDryRunScanResults(makeGlobalOpts(), "packageDryRunScanJobs:1", {
      json: true,
      limit: 1,
    });

    const output = mockWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(JSON.parse(output)).toEqual({
      items: [item],
      jobStatus: "completed",
      jobDone: true,
      partial: false,
      nextCursor: null,
      done: true,
    });
    expect(httpMocks.apiRequest).toHaveBeenCalledTimes(2);
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("returns next cursor for JSON exports that do not fit in one page", async () => {
    httpMocks.apiRequest
      .mockResolvedValueOnce(makeDryRunScanJob("completed"))
      .mockResolvedValueOnce({
        jobStatus: "completed",
        jobDone: true,
        partial: false,
        items: [
          {
            itemId: "packageDryRunScanResults:1",
            jobId: "packageDryRunScanJobs:1",
            releaseId: "packageReleases:demo",
            packageId: "packages:demo",
            packageName: "demo-plugin",
            packageDisplayName: "Demo Plugin",
            version: "1.0.0",
            status: "completed",
            rawFsUsageCount: 1,
            fsSafeUsageCount: 0,
            findings: [],
            errors: [],
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_100,
          },
        ],
        nextCursor: "cursor-2",
        done: false,
      });

    await cmdExportPackageDryRunScanResults(makeGlobalOpts(), "packageDryRunScanJobs:1", {
      json: true,
      limit: 1,
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledTimes(2);
    const output = mockWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(JSON.parse(output)).toMatchObject({ nextCursor: "cursor-2", done: false });
  });

  it("prints dry-run scan finding evidence in human-readable exports", async () => {
    httpMocks.apiRequest
      .mockResolvedValueOnce(makeDryRunScanJob("completed"))
      .mockResolvedValueOnce({
        items: [
          {
            itemId: "packageDryRunScanResults:1",
            jobId: "packageDryRunScanJobs:1",
            releaseId: "packageReleases:demo",
            packageId: "packages:demo",
            packageName: "demo-plugin",
            packageDisplayName: "Demo Plugin",
            version: "1.0.0",
            status: "completed",
            rawFsUsageCount: 1,
            fsSafeUsageCount: 0,
            findings: [
              {
                code: "raw-fs-usage\u001b[0m",
                severity: "medium\u001b[31m",
                file: "src/\u001b]8;;https://example.invalid\u0007index.ts",
                line: 12,
                message: "Raw filesystem API usage detected\u001b[31m",
                evidence: "fs.readFileSync(path)\n\u001b[2J\u202e",
                evidenceTruncated: false,
              },
            ],
            errors: ["worker warning\u001b[0m"],
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_100,
          },
        ],
        nextCursor: null,
        done: true,
      });

    await cmdExportPackageDryRunScanResults(makeGlobalOpts(), "packageDryRunScanJobs:1", {});

    expect(mockLog).toHaveBeenCalledWith(
      "demo-plugin@1.0.0 completed raw-fs:1 fs-safe:0 findings:1",
    );
    expect(mockLog).toHaveBeenCalledWith(
      "  medium\\x1b[31m raw-fs-usage\\x1b[0m src/\\x1b]8;;https://example.invalid\\x07index.ts:12: Raw filesystem API usage detected\\x1b[31m",
    );
    expect(mockLog).toHaveBeenCalledWith("    evidence: fs.readFileSync(path)\\n\\x1b[2J\\u202e");
    expect(mockLog).toHaveBeenCalledWith("  error: worker warning\\x1b[0m");
  });

  it("rejects partial dry-run scan exports without explicit opt-in", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce(makeDryRunScanJob("running"));

    await expect(
      cmdExportPackageDryRunScanResults(makeGlobalOpts(), "packageDryRunScanJobs:1\u001b[31m", {
        json: true,
      }),
    ).rejects.toThrow(
      "Dry-run scan packageDryRunScanJobs:1\\x1b[31m is running; use --allow-partial to export incomplete results",
    );

    expect(httpMocks.apiRequest).toHaveBeenCalledTimes(1);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("rejects terminal dry-run scan exports when target selection did not finish", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ...makeDryRunScanJob("failed"),
      selector: { kind: "allActive" },
      targetSelectionDone: false,
    });

    await expect(
      cmdExportPackageDryRunScanResults(makeGlobalOpts(), "packageDryRunScanJobs:1", {
        json: true,
      }),
    ).rejects.toThrow(
      "Dry-run scan packageDryRunScanJobs:1 is failed; use --allow-partial to export incomplete results",
    );

    expect(httpMocks.apiRequest).toHaveBeenCalledTimes(1);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("exports partial dry-run scan results when explicitly requested", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce(makeDryRunScanJob("running")).mockResolvedValueOnce({
      jobStatus: "running",
      jobDone: false,
      partial: true,
      items: [],
      nextCursor: null,
      done: true,
    });

    await cmdExportPackageDryRunScanResults(makeGlobalOpts(), "packageDryRunScanJobs:1", {
      json: true,
      allowPartial: true,
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledTimes(2);
    const output = mockWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(JSON.parse(output)).toEqual({
      jobStatus: "running",
      jobDone: false,
      partial: true,
      items: [],
      nextCursor: null,
      done: true,
    });
  });

  it("allows --allow-partial with JSONL when the dry-run scan is complete", async () => {
    httpMocks.apiRequest
      .mockResolvedValueOnce(makeDryRunScanJob("completed"))
      .mockResolvedValueOnce({
        jobStatus: "completed",
        jobDone: true,
        partial: false,
        items: [],
        nextCursor: null,
        done: true,
      });

    await cmdExportPackageDryRunScanResults(makeGlobalOpts(), "packageDryRunScanJobs:1", {
      jsonl: true,
      allowPartial: true,
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledTimes(2);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("requires JSON output for partial dry-run scan exports", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce(makeDryRunScanJob("running"));

    await expect(
      cmdExportPackageDryRunScanResults(makeGlobalOpts(), "packageDryRunScanJobs:1", {
        allowPartial: true,
        jsonl: true,
      }),
    ).rejects.toThrow(
      "Partial dry-run scan exports require --json so job completion metadata is preserved",
    );

    expect(httpMocks.apiRequest).toHaveBeenCalledTimes(1);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("rejects mutually exclusive dry-run scan export output modes", async () => {
    await expect(
      cmdExportPackageDryRunScanResults(makeGlobalOpts(), "packageDryRunScanJobs:1", {
        json: true,
        jsonl: true,
      }),
    ).rejects.toThrow("Use only one of --json or --jsonl");
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });
});

function makeDryRunScanJob(status: "queued" | "running" | "completed" | "failed") {
  return {
    jobId: "packageDryRunScanJobs:1",
    scanner: "filesystem-safety-v1",
    selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
    status,
    totalItems: 1,
    queuedItems: status === "queued" ? 1 : 0,
    runningItems: status === "running" ? 1 : 0,
    completedItems: status === "completed" ? 1 : 0,
    failedItems: status === "failed" ? 1 : 0,
    skippedItems: 0,
    matchedItems: 0,
    targetSelectionDone: true,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_100,
  };
}
