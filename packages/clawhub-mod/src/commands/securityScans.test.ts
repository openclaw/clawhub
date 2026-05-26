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
  cmdInspectSecurityScanArtifact,
  cmdListFailedSecurityScans,
  cmdListQueuedSecurityScans,
  cmdListSecurityScanArtifacts,
  cmdSecurityScanOverview,
} = await import("./securityScans");

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function silenceStdout() {
  return vi.spyOn(process.stdout, "write").mockImplementation(() => true);
}

describe("security scan commands", () => {
  it("prints overview JSON from the security scans endpoint", async () => {
    const stdout = silenceStdout();
    const overview = {
      generatedAt: 1,
      window: { hours: 24, totalsByKind: {}, rows: [], truncated: false },
      current: {},
      failed: { items: [], limit: 10 },
    };
    httpMocks.apiRequest.mockResolvedValueOnce(overview);

    const result = await cmdSecurityScanOverview(makeGlobalOpts(), {
      artifactKind: "skill",
      windowHours: "24",
      failedLimit: "3",
      json: true,
    });

    expect(result).toEqual(overview);
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "GET",
        token: "tkn",
        url: expect.stringContaining("/api/v1/security-scans/overview?"),
      }),
      expect.anything(),
    );
    const request = httpMocks.apiRequest.mock.calls[0]?.[1] as { url: string };
    expect(request.url).toContain("artifactKind=skill");
    expect(request.url).toContain("windowHours=24");
    expect(request.url).toContain("failedLimit=3");
    expect(stdout).toHaveBeenCalledWith(`${JSON.stringify(overview, null, 2)}\n`);
  });

  it("lists failed scans across skills and plugins for the all view", async () => {
    const stdout = silenceStdout();
    httpMocks.apiRequest
      .mockResolvedValueOnce({
        items: [
          {
            artifactKind: "skill",
            slug: "bad-skill",
            displayName: "Bad Skill",
            clawScanVerdict: "failed",
            scanJobStatus: "failed",
            failureStatus: "failed",
            updatedAt: 20,
          },
        ],
        nextCursor: null,
        done: true,
        limit: 2,
      })
      .mockResolvedValueOnce({
        items: [
          {
            artifactKind: "plugin",
            name: "@bad/plugin",
            displayName: "Bad Plugin",
            clawScanVerdict: "malicious",
            scanJobStatus: "failed",
            failureStatus: "failed",
            updatedAt: 10,
          },
        ],
        nextCursor: null,
        done: true,
        limit: 2,
      });

    const result = await cmdListFailedSecurityScans(makeGlobalOpts(), { limit: "2", json: true });

    expect(result.items).toHaveLength(2);
    const urls = httpMocks.apiRequest.mock.calls.map((call) => (call[1] as { url: string }).url);
    expect(urls[0]).toContain("artifactKind=skill");
    expect(urls[0]).toContain("failureStatus=failed");
    expect(urls[1]).toContain("artifactKind=plugin");
    expect(urls[1]).toContain("failureStatus=failed");
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"artifactKind": "all"'));
  });

  it("lists queued plugin scans with cursor pagination", async () => {
    silenceStdout();
    httpMocks.apiRequest.mockResolvedValueOnce({
      items: [],
      nextCursor: "next",
      done: false,
      limit: 5,
    });

    await cmdListQueuedSecurityScans(makeGlobalOpts(), {
      artifactKind: "plugin",
      cursor: "c1",
      limit: 5,
      json: true,
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledTimes(1);
    const request = httpMocks.apiRequest.mock.calls[0]?.[1] as { url: string };
    expect(request.url).toContain("artifactKind=plugin");
    expect(request.url).toContain("scanJobStatus=queued");
    expect(request.url).toContain("cursor=c1");
    expect(request.url).toContain("limit=5");
  });

  it("inspects a specific skill scan artifact", async () => {
    silenceStdout();
    const detail = {
      found: true,
      artifactKind: "skill",
      state: null,
      artifact: {},
      scanJob: null,
      evidence: {},
    };
    httpMocks.apiRequest.mockResolvedValueOnce(detail);

    const result = await cmdInspectSecurityScanArtifact(makeGlobalOpts(), {
      skill: "demo",
      json: true,
    });

    expect(result).toEqual(detail);
    const request = httpMocks.apiRequest.mock.calls[0]?.[1] as { url: string };
    expect(request.url).toContain("/api/v1/security-scans/artifact?");
    expect(request.url).toContain("skillSlug=demo");
  });

  it("rejects ambiguous inspect targets", async () => {
    await expect(
      cmdInspectSecurityScanArtifact(makeGlobalOpts(), {
        skill: "demo",
        plugin: "@demo/plugin",
      }),
    ).rejects.toThrow(/exactly one/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("rejects multiple list filters before calling the API", async () => {
    await expect(
      cmdListSecurityScanArtifacts(makeGlobalOpts(), {
        artifactKind: "skill",
        verdict: "malicious",
        scanJobStatus: "failed",
      }),
    ).rejects.toThrow(/at most one/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("surfaces auth or permission failures from the endpoint", async () => {
    httpMocks.apiRequest.mockRejectedValueOnce(new Error("Moderator role required."));

    await expect(
      cmdSecurityScanOverview(makeGlobalOpts(), { artifactKind: "plugin" }),
    ).rejects.toThrow(/moderator role/i);
    expect(authTokenMocks.requireAuthToken).toHaveBeenCalled();
  });
});
