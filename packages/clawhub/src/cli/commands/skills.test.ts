/* @vitest-environment node */

import * as fsPromises from "node:fs/promises";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthTokenModuleMocks,
  createHttpModuleMocks,
  createRegistryModuleMocks,
  createUiModuleMocks,
  makeGlobalOpts,
} from "../../../test/cliCommandTestKit.js";
import { ApiRoutes, LegacyApiRoutes } from "../../schema/index.js";
import * as skillStore from "../../skills.js";

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    mkdir: fsMocks.mkdir,
    rm: fsMocks.rm,
    stat: fsMocks.stat,
  };
});

const mocked = <T>(value: T) => value as T & Record<string, unknown>;
Object.assign(vi as object, { mocked });

const authTokenMocks = createAuthTokenModuleMocks();
const registryMocks = createRegistryModuleMocks();
const httpMocks = createHttpModuleMocks();
const uiMocks = createUiModuleMocks();
const mockApiRequest = httpMocks.apiRequest;
const mockDownloadZip = httpMocks.downloadZip;
const mockFetchBinary = httpMocks.fetchBinary;
const mockGetOptionalAuthToken = authTokenMocks.getOptionalAuthToken;
const mockSpinner = uiMocks.spinner;
const mockIsInteractive = vi.fn(() => false);
const mockPromptConfirm = vi.fn(async () => false);
vi.mock("../../http.js", () => httpMocks.moduleFactory());
vi.mock("../registry.js", () => registryMocks.moduleFactory());
vi.mock("../authToken.js", () => authTokenMocks.moduleFactory());
vi.mock("../ui.js", () => ({
  createSpinner: vi.fn(() => mockSpinner),
  fail: (message: string) => uiMocks.fail(message),
  formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  isInteractive: mockIsInteractive,
  promptConfirm: mockPromptConfirm,
}));

const extractZipToDirMock = vi.spyOn(skillStore, "extractZipToDir");
const extractGitHubZipPathToDirMock = vi.spyOn(skillStore, "extractGitHubZipPathToDir");
const hashSkillFilesMock = vi.spyOn(skillStore, "hashSkillFiles");
const listTextFilesMock = vi.spyOn(skillStore, "listTextFiles");
const readLockfileMock = vi.spyOn(skillStore, "readLockfile");
const readSkillOriginMock = vi.spyOn(skillStore, "readSkillOrigin");
const writeLockfileMock = vi.spyOn(skillStore, "writeLockfile");
const writeSkillOriginMock = vi.spyOn(skillStore, "writeSkillOrigin");

const mkdirMock = fsMocks.mkdir;
const rmMock = fsMocks.rm;
const statMock = fsMocks.stat;
const {
  clampLimit,
  cmdExplore,
  cmdInstall,
  cmdList,
  cmdListSkillReports,
  cmdPin,
  cmdReportSkill,
  cmdSearch,
  cmdTriageSkillReport,
  cmdUninstall,
  cmdUnpin,
  cmdUpdate,
  formatExploreLine,
} = await import("./skills.js");
const {
  extractGitHubZipPathToDir,
  extractZipToDir,
  hashSkillFiles,
  listTextFiles,
  readLockfile,
  readSkillOrigin,
  writeLockfile,
  writeSkillOrigin,
} = skillStore;
const { rm, stat } = fsPromises;

const mockLog = vi.spyOn(console, "log").mockImplementation(() => {});

function makeOpts() {
  return makeGlobalOpts();
}

beforeEach(() => {
  mkdirMock.mockResolvedValue(undefined);
  rmMock.mockResolvedValue(undefined);
  statMock.mockRejectedValue(new Error("missing"));
  extractZipToDirMock.mockResolvedValue(undefined);
  extractGitHubZipPathToDirMock.mockResolvedValue(undefined);
  hashSkillFilesMock.mockReturnValue({ fingerprint: "hash", files: [] });
  listTextFilesMock.mockResolvedValue([]);
  readLockfileMock.mockResolvedValue({ version: 1, skills: {} });
  readSkillOriginMock.mockResolvedValue(null);
  writeLockfileMock.mockResolvedValue(undefined);
  writeSkillOriginMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  extractZipToDirMock.mockRestore();
  extractGitHubZipPathToDirMock.mockRestore();
  hashSkillFilesMock.mockRestore();
  listTextFilesMock.mockRestore();
  readLockfileMock.mockRestore();
  readSkillOriginMock.mockRestore();
  writeLockfileMock.mockRestore();
  writeSkillOriginMock.mockRestore();
});

describe("explore helpers", () => {
  it("clamps explore limits and handles non-finite values", () => {
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(1)).toBe(1);
    expect(clampLimit(50)).toBe(50);
    expect(clampLimit(99)).toBe(99);
    expect(clampLimit(200)).toBe(200);
    expect(clampLimit(250)).toBe(200);
    expect(clampLimit(Number.NaN)).toBe(25);
    expect(clampLimit(Number.POSITIVE_INFINITY)).toBe(25);
    expect(clampLimit(Number.NaN, 10)).toBe(10);
  });

  it("formats explore lines with relative time and truncation", () => {
    const now = 4 * 60 * 60 * 1000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const summary = "a".repeat(60);
    const line = formatExploreLine({
      slug: "weather",
      summary,
      updatedAt: now - 2 * 60 * 60 * 1000,
      latestVersion: null,
    });
    expect(line).toBe(`weather  v?  2h ago  ${"a".repeat(49)}…`);
    nowSpy.mockRestore();
  });
});

describe("cmdExplore", () => {
  it("passes optional auth token to apiRequest", async () => {
    mockGetOptionalAuthToken.mockResolvedValue("tkn");
    mockApiRequest.mockResolvedValue({ items: [] });

    await cmdExplore(makeOpts(), { limit: 25 });

    const [, requestArgs] = mockApiRequest.mock.calls[0] ?? [];
    expect(requestArgs?.token).toBe("tkn");
  });

  it("clamps limit and handles empty results", async () => {
    mockApiRequest.mockResolvedValue({ items: [] });

    await cmdExplore(makeOpts(), { limit: 0 });

    const [, args] = mockApiRequest.mock.calls[0] ?? [];
    const url = new URL(String(args?.url));
    expect(url.searchParams.get("limit")).toBe("1");
    expect(mockLog).toHaveBeenCalledWith("No skills found.");
  });

  it("prints formatted results", async () => {
    const now = 10 * 60 * 1000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const item = {
      slug: "gog",
      summary: "Google Workspace CLI for Gmail, Calendar, Drive and more.",
      updatedAt: now - 90 * 1000,
      latestVersion: { version: "1.2.3" },
    };
    mockApiRequest.mockResolvedValue({ items: [item] });

    await cmdExplore(makeOpts(), { limit: 250 });

    const [, args] = mockApiRequest.mock.calls[0] ?? [];
    const url = new URL(String(args?.url));
    expect(url.searchParams.get("limit")).toBe("200");
    expect(mockLog).toHaveBeenCalledWith(formatExploreLine(item));
    nowSpy.mockRestore();
  });

  it("supports sort and json output", async () => {
    const payload = { items: [], nextCursor: null };
    mockApiRequest.mockResolvedValue(payload);

    await cmdExplore(makeOpts(), { limit: 10, sort: "installs", json: true });

    const [, args] = mockApiRequest.mock.calls[0] ?? [];
    const url = new URL(String(args?.url));
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("sort")).toBe("installsCurrent");
    expect(mockLog).toHaveBeenCalledWith(JSON.stringify(payload, null, 2));
  });

  it("supports all-time installs and trending sorts", async () => {
    mockApiRequest.mockResolvedValue({ items: [], nextCursor: null });

    await cmdExplore(makeOpts(), { limit: 5, sort: "newest" });
    await cmdExplore(makeOpts(), { limit: 5, sort: "installsAllTime" });
    await cmdExplore(makeOpts(), { limit: 5, sort: "trending" });

    const first = new URL(String(mockApiRequest.mock.calls[0]?.[1]?.url));
    const second = new URL(String(mockApiRequest.mock.calls[1]?.[1]?.url));
    const third = new URL(String(mockApiRequest.mock.calls[2]?.[1]?.url));
    expect(first.searchParams.get("sort")).toBe("createdAt");
    expect(second.searchParams.get("sort")).toBe("installsAllTime");
    expect(third.searchParams.get("sort")).toBe("trending");
  });
});

describe("cmdSearch", () => {
  it("passes optional auth token to apiRequest", async () => {
    mockGetOptionalAuthToken.mockResolvedValue("tkn");
    mockApiRequest.mockResolvedValue({ results: [] });

    await cmdSearch(makeOpts(), "demo");

    const [, requestArgs] = mockApiRequest.mock.calls[0] ?? [];
    expect(requestArgs?.token).toBe("tkn");
  });

  it("defaults limit to 25 when not specified", async () => {
    mockGetOptionalAuthToken.mockResolvedValue(undefined);
    mockApiRequest.mockResolvedValue({ results: [] });

    await cmdSearch(makeOpts(), "stock price");

    const [, requestArgs] = mockApiRequest.mock.calls[0] ?? [];
    const url = new URL(String(requestArgs?.url));
    expect(url.searchParams.get("limit")).toBe("25");
  });

  it("uses explicit limit when provided", async () => {
    mockGetOptionalAuthToken.mockResolvedValue(undefined);
    mockApiRequest.mockResolvedValue({ results: [] });

    await cmdSearch(makeOpts(), "stock price", 5);

    const [, requestArgs] = mockApiRequest.mock.calls[0] ?? [];
    const url = new URL(String(requestArgs?.url));
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("prints skill owners in search results", async () => {
    mockGetOptionalAuthToken.mockResolvedValue(undefined);
    mockApiRequest.mockResolvedValue({
      results: [
        {
          slug: "demo",
          displayName: "Demo Skill",
          version: "1.2.3",
          ownerHandle: "openclaw",
          score: 0.9876,
        },
        {
          slug: "legacy",
          displayName: "Legacy Skill",
          version: null,
          owner: { displayName: "Legacy Owner" },
          score: 0.5,
        },
      ],
    });

    await cmdSearch(makeOpts(), "demo");

    expect(mockLog).toHaveBeenCalledWith("demo v1.2.3  @openclaw  Demo Skill  (0.988)");
    expect(mockLog).toHaveBeenCalledWith("legacy  Legacy Owner  Legacy Skill  (0.500)");
  });
});

describe("skill moderation commands", () => {
  it("submits skill reports", async () => {
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      reported: true,
      alreadyReported: false,
      reportId: "skillReports:1",
      skillId: "skills:1",
      reportCount: 1,
    });

    await cmdReportSkill(makeOpts(), "demo", { version: "1.0.0", reason: "suspicious files" });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      {
        method: "POST",
        path: "/api/v1/skills/demo/report",
        token: "tkn",
        body: { reason: "suspicious files", version: "1.0.0" },
      },
      expect.anything(),
    );
    expect(mockLog).toHaveBeenCalledWith("OK. Reported demo (skillReports:1).");
  });

  it("lists skill reports", async () => {
    mockApiRequest.mockResolvedValueOnce({
      items: [
        {
          reportId: "skillReports:1",
          skillId: "skills:1",
          skillVersionId: "skillVersions:1",
          slug: "demo",
          displayName: "Demo",
          version: "1.0.0",
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

    await cmdListSkillReports(makeOpts(), { status: "open", limit: 10 });

    const request = mockApiRequest.mock.calls[0]?.[1] as { url?: string } | undefined;
    const url = new URL(String(request?.url));
    expect(url.pathname).toBe("/api/v1/skills/-/reports");
    expect(url.searchParams.get("status")).toBe("open");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(mockLog).toHaveBeenCalledWith("skillReports:1 open demo");
  });

  it("triages skill reports", async () => {
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      reportId: "skillReports:1",
      skillId: "skills:1",
      status: "confirmed",
      reportCount: 0,
      actionTaken: "hide",
    });

    await cmdTriageSkillReport(makeOpts(), "skillReports:1", {
      status: "confirmed",
      note: "handled",
      action: "hide",
      yes: true,
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      {
        method: "POST",
        path: "/api/v1/skills/-/reports/skillReports%3A1/triage",
        token: "tkn",
        body: { status: "confirmed", note: "handled", finalAction: "hide" },
      },
      expect.anything(),
    );
    expect(mockLog).toHaveBeenCalledWith(
      "OK. Skill report skillReports:1 set to confirmed; action hide.",
    );
    expect(mockLog).toHaveBeenCalledWith("  - Hide the skill from public availability.");
  });
});

describe("cmdUpdate", () => {
  it("fails when directly updating a pinned skill", async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: {
        demo: { version: "0.1.0", installedAt: 123, pinned: true, pinReason: "hold" },
      },
    });

    await expect(cmdUpdate(makeOpts(), "demo", { force: true }, false)).rejects.toThrow(
      /is pinned/i,
    );

    expect(mockApiRequest).not.toHaveBeenCalled();
    expect(mockDownloadZip).not.toHaveBeenCalled();
  });

  it("skips pinned skills during update --all and reports them in the summary", async () => {
    mockApiRequest.mockResolvedValue({
      latestVersion: { version: "2.0.0" },
      moderation: null,
    });
    mockDownloadZip.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: {
        demo: { version: "0.1.0", installedAt: 123, pinned: true, pinReason: "hold" },
        other: { version: "1.0.0", installedAt: 456 },
      },
    });
    vi.mocked(writeLockfile).mockResolvedValue();
    vi.mocked(readSkillOrigin).mockResolvedValue(null);
    vi.mocked(writeSkillOrigin).mockResolvedValue();
    vi.mocked(extractZipToDir).mockResolvedValue();
    vi.mocked(listTextFiles).mockResolvedValue([]);
    vi.mocked(hashSkillFiles).mockReturnValue({ fingerprint: "hash", files: [] });
    vi.mocked(stat).mockRejectedValue(new Error("missing"));
    vi.mocked(rm).mockResolvedValue();

    await cmdUpdate(makeOpts(), undefined, { all: true }, false);

    expect(mockApiRequest).toHaveBeenCalledTimes(1);
    const [, args] = mockApiRequest.mock.calls[0] ?? [];
    expect(args?.path).toBe(`${ApiRoutes.skills}/${encodeURIComponent("other")}`);
    expect(writeLockfile).toHaveBeenCalledWith("/work", {
      version: 1,
      skills: {
        demo: { version: "0.1.0", installedAt: 123, pinned: true, pinReason: "hold" },
        other: { version: "2.0.0", installedAt: expect.any(Number) },
      },
    });
    expect(mockLog).toHaveBeenCalledWith("Skipped 1 pinned skill: demo");
  });

  it("continues update --all when a source-backed resolver response blocks one skill", async () => {
    mockApiRequest
      .mockResolvedValueOnce({
        latestVersion: null,
        moderation: null,
      })
      .mockResolvedValueOnce({
        ok: false,
        slug: "stale-github",
        reason: "github_verification_pending",
        message: "stale-github changed upstream; waiting for ClawHub scan.",
        status: 423,
      })
      .mockResolvedValueOnce({
        latestVersion: { version: "2.0.0" },
        moderation: null,
      });
    mockDownloadZip.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: {
        "stale-github": { version: "a".repeat(40), installedAt: 123 },
        demo: { version: "1.0.0", installedAt: 456 },
      },
    });
    vi.mocked(writeLockfile).mockResolvedValue();
    vi.mocked(writeSkillOrigin).mockResolvedValue();
    vi.mocked(extractZipToDir).mockResolvedValue();
    vi.mocked(listTextFiles).mockResolvedValue([]);

    await cmdUpdate(makeOpts(), undefined, { all: true }, false);

    expect(mockSpinner.fail).toHaveBeenCalledWith(
      "stale-github: stale-github changed upstream; waiting for ClawHub scan.",
    );
    expect(mockDownloadZip).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({ slug: "demo", version: "2.0.0" }),
    );
    expect(writeLockfile).toHaveBeenCalledWith("/work", {
      version: 1,
      skills: {
        "stale-github": { version: "a".repeat(40), installedAt: 123 },
        demo: { version: "2.0.0", installedAt: expect.any(Number) },
      },
    });
    const [, resolverArgs] = mockApiRequest.mock.calls[1] ?? [];
    expect(resolverArgs).toEqual(
      expect.objectContaining({
        path: `${ApiRoutes.skills}/${encodeURIComponent("stale-github")}/install`,
        acceptedStatuses: [403, 409, 410, 423],
      }),
    );
  });

  it("passes force-install to source-backed update resolution", async () => {
    const commit = "d".repeat(40);
    mockApiRequest
      .mockResolvedValueOnce({
        latestVersion: null,
        moderation: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        slug: "aiq-deploy",
        installKind: "github",
        github: {
          repo: "NVIDIA/skills",
          path: "skills/aiq-deploy",
          commit,
          contentHash: "hash-aiq-deploy",
          sourceUrl: `https://github.com/NVIDIA/skills/tree/${commit}/skills/aiq-deploy`,
        },
      });
    mockFetchBinary.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { "aiq-deploy": { version: "a".repeat(40), installedAt: 123 } },
    });
    vi.mocked(readSkillOrigin).mockResolvedValue({
      version: 1,
      registry: "https://clawhub.ai",
      slug: "aiq-deploy",
      installedVersion: "a".repeat(40),
      installedAt: 123,
      fingerprint: "hash",
    });
    vi.mocked(stat).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof stat>>);

    await cmdUpdate(makeOpts(), "aiq-deploy", { forceInstall: true }, false);

    const [, resolverArgs] = mockApiRequest.mock.calls[1] ?? [];
    expect(resolverArgs).toEqual(
      expect.objectContaining({
        path: `${ApiRoutes.skills}/${encodeURIComponent("aiq-deploy")}/install?forceInstall=1`,
      }),
    );
  });

  it("uses path-based skill lookup when no local fingerprint is available", async () => {
    mockApiRequest.mockResolvedValue({ latestVersion: { version: "1.0.0" } });
    mockDownloadZip.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: "0.1.0", installedAt: 123 } },
    });
    vi.mocked(writeLockfile).mockResolvedValue();
    vi.mocked(readSkillOrigin).mockResolvedValue(null);
    vi.mocked(writeSkillOrigin).mockResolvedValue();
    vi.mocked(extractZipToDir).mockResolvedValue();
    vi.mocked(listTextFiles).mockResolvedValue([]);
    vi.mocked(hashSkillFiles).mockReturnValue({ fingerprint: "hash", files: [] });
    vi.mocked(stat).mockRejectedValue(new Error("missing"));
    vi.mocked(rm).mockResolvedValue();

    await cmdUpdate(makeOpts(), "demo", {}, false);

    const [, args] = mockApiRequest.mock.calls[0] ?? [];
    expect(args?.path).toBe(`${ApiRoutes.skills}/${encodeURIComponent("demo")}`);
    expect(args?.url).toBeUndefined();
  });

  it("does not overwrite GitHub-backed local files when the origin fingerprint is missing", async () => {
    const commit = "b".repeat(40);
    mockApiRequest
      .mockResolvedValueOnce({
        latestVersion: null,
        moderation: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        slug: "aiq-deploy",
        installKind: "github",
        github: {
          repo: "NVIDIA/skills",
          path: "skills/aiq-deploy",
          commit,
          contentHash: "hash-aiq-deploy",
          sourceUrl: `https://github.com/NVIDIA/skills/tree/${commit}/skills/aiq-deploy`,
        },
      });
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { "aiq-deploy": { version: "a".repeat(40), installedAt: 123 } },
    });
    vi.mocked(readSkillOrigin).mockResolvedValue({
      version: 1,
      registry: "https://clawhub.ai",
      slug: "aiq-deploy",
      installedVersion: "a".repeat(40),
      installedAt: 123,
    });
    vi.mocked(listTextFiles).mockResolvedValue([
      { relPath: "SKILL.md", bytes: new Uint8Array([1]) },
    ]);
    vi.mocked(hashSkillFiles).mockReturnValue({ fingerprint: "local-fingerprint", files: [] });
    vi.mocked(stat).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof stat>>);

    await cmdUpdate(makeOpts(), "aiq-deploy", {}, false);

    expect(mockLog).toHaveBeenCalledWith(
      "aiq-deploy: local changes (no match). Use --force to overwrite.",
    );
    expect(rm).not.toHaveBeenCalled();
    expect(mockFetchBinary).not.toHaveBeenCalled();
    expect(extractGitHubZipPathToDir).not.toHaveBeenCalled();
  });

  it("reinstalls GitHub-backed skills when only the lockfile remains", async () => {
    const commit = "c".repeat(40);
    mockApiRequest
      .mockResolvedValueOnce({
        latestVersion: null,
        moderation: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        slug: "aiq-deploy",
        installKind: "github",
        github: {
          repo: "NVIDIA/skills",
          path: "skills/aiq-deploy",
          commit,
          contentHash: "hash-aiq-deploy",
          sourceUrl: `https://github.com/NVIDIA/skills/tree/${commit}/skills/aiq-deploy`,
        },
      });
    mockFetchBinary.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { "aiq-deploy": { version: commit, installedAt: 123 } },
    });
    vi.mocked(readSkillOrigin).mockResolvedValue(null);
    vi.mocked(listTextFiles).mockResolvedValueOnce([
      { relPath: "SKILL.md", bytes: new Uint8Array([1]) },
    ]);
    vi.mocked(hashSkillFiles).mockReturnValue({ fingerprint: "clean-fingerprint", files: [] });
    vi.mocked(stat).mockRejectedValue(new Error("missing"));

    await cmdUpdate(makeOpts(), "aiq-deploy", {}, false);

    expect(mockFetchBinary).toHaveBeenCalledWith("https://clawhub.ai", {
      url: `https://codeload.github.com/NVIDIA/skills/zip/${commit}`,
    });
    expect(extractGitHubZipPathToDir).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      "/work/skills/aiq-deploy",
      "skills/aiq-deploy",
    );
    expect(mockSpinner.succeed).toHaveBeenCalledWith(
      `aiq-deploy: updated -> ${commit.slice(0, 12)}`,
    );
  });

  it("overwrites confirmed GitHub-backed local changes even when already at latest commit", async () => {
    const commit = "b".repeat(40);
    mockIsInteractive.mockReturnValue(true);
    mockPromptConfirm.mockResolvedValue(true);
    mockApiRequest
      .mockResolvedValueOnce({
        latestVersion: null,
        moderation: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        slug: "aiq-deploy",
        installKind: "github",
        github: {
          repo: "NVIDIA/skills",
          path: "skills/aiq-deploy",
          commit,
          contentHash: "hash-aiq-deploy",
          sourceUrl: `https://github.com/NVIDIA/skills/tree/${commit}/skills/aiq-deploy`,
        },
      });
    mockFetchBinary.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { "aiq-deploy": { version: commit, installedAt: 123 } },
    });
    vi.mocked(readSkillOrigin).mockResolvedValue({
      version: 1,
      registry: "https://clawhub.ai",
      slug: "aiq-deploy",
      installedVersion: commit,
      installedAt: 123,
      fingerprint: "clean-fingerprint",
    });
    vi.mocked(listTextFiles)
      .mockResolvedValueOnce([{ relPath: "SKILL.md", bytes: new Uint8Array([9]) }])
      .mockResolvedValueOnce([{ relPath: "SKILL.md", bytes: new Uint8Array([1]) }]);
    vi.mocked(hashSkillFiles)
      .mockReturnValueOnce({ fingerprint: "dirty-fingerprint", files: [] })
      .mockReturnValueOnce({ fingerprint: "clean-fingerprint", files: [] });
    vi.mocked(stat).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof stat>>);

    await cmdUpdate(makeOpts(), "aiq-deploy", {}, true);

    expect(mockPromptConfirm).toHaveBeenCalledWith(
      `aiq-deploy: local changes (no match). Overwrite with ${commit.slice(0, 12)}?`,
    );
    expect(rm).toHaveBeenCalledWith("/work/skills/aiq-deploy", {
      recursive: true,
      force: true,
    });
    expect(mockFetchBinary).toHaveBeenCalledWith("https://clawhub.ai", {
      url: `https://codeload.github.com/NVIDIA/skills/zip/${commit}`,
    });
    expect(extractGitHubZipPathToDir).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      "/work/skills/aiq-deploy",
      "skills/aiq-deploy",
    );
    expect(mockSpinner.succeed).toHaveBeenCalledWith(
      `aiq-deploy: updated -> ${commit.slice(0, 12)}`,
    );
  });

  it("trusts the stored install fingerprint when the resolve endpoint cannot match", async () => {
    mockApiRequest
      .mockResolvedValueOnce({
        latestVersion: { version: "2.0.0" },
        moderation: null,
      })
      .mockResolvedValueOnce({
        match: null,
        latestVersion: { version: "2.0.0" },
      });
    mockDownloadZip.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: "1.0.0", installedAt: 123 } },
    });
    vi.mocked(readSkillOrigin).mockResolvedValue({
      version: 1,
      registry: "https://clawhub.ai",
      slug: "demo",
      installedVersion: "1.0.0",
      installedAt: 123,
      fingerprint: "hash",
    });
    vi.mocked(writeLockfile).mockResolvedValue();
    vi.mocked(writeSkillOrigin).mockResolvedValue();
    vi.mocked(extractZipToDir).mockResolvedValue();
    vi.mocked(listTextFiles).mockResolvedValue([
      { relPath: "SKILL.md", bytes: new Uint8Array([1]) },
    ]);
    vi.mocked(hashSkillFiles).mockReturnValue({ fingerprint: "hash", files: [] });
    vi.mocked(stat).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof stat>>);
    vi.mocked(rm).mockResolvedValue();

    await cmdUpdate(makeOpts(), "demo", {}, false);

    expect(mockLog).not.toHaveBeenCalledWith(
      "demo: local changes (no match). Use --force to overwrite.",
    );
    expect(mockDownloadZip).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({ slug: "demo", version: "2.0.0" }),
    );
    expect(writeSkillOrigin).toHaveBeenCalledWith("/work/skills/demo", {
      version: 1,
      registry: "https://clawhub.ai",
      slug: "demo",
      installedVersion: "2.0.0",
      installedAt: 123,
      fingerprint: "hash",
    });
  });

  it("treats an installed bundle fingerprint that includes skill-card.md as synced", async () => {
    mockApiRequest
      .mockResolvedValueOnce({
        latestVersion: { version: "1.0.0" },
        moderation: null,
      })
      .mockResolvedValueOnce({
        match: { version: "1.0.0" },
        latestVersion: { version: "1.0.0" },
      });
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: "1.0.0", installedAt: 123 } },
    });
    vi.mocked(readSkillOrigin).mockResolvedValue(null);
    vi.mocked(listTextFiles).mockResolvedValue([
      { relPath: "SKILL.md", bytes: new Uint8Array([1]) },
      { relPath: "skill-card.md", bytes: new Uint8Array([2]) },
    ]);
    vi.mocked(hashSkillFiles).mockReturnValue({ fingerprint: "bundle-fingerprint", files: [] });
    vi.mocked(stat).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof stat>>);

    await cmdUpdate(makeOpts(), "demo", {}, false);

    const [, resolveArgs] = mockApiRequest.mock.calls[1] ?? [];
    const url = new URL(String(resolveArgs?.url));
    expect(url.pathname).toBe(ApiRoutes.resolve);
    expect(url.searchParams.get("slug")).toBe("demo");
    expect(url.searchParams.get("hash")).toBe("bundle-fingerprint");
    expect(mockDownloadZip).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
    expect(mockSpinner.succeed).toHaveBeenCalledWith("demo: up to date (1.0.0)");
  });

  it("writes identical installedAt to origin and lockfile on update", async () => {
    mockApiRequest.mockResolvedValue({
      skill: {
        slug: "demo",
        displayName: "Demo",
        summary: null,
        tags: {},
        stats: {},
        createdAt: 0,
        updatedAt: 0,
      },
      latestVersion: { version: "2.0.0" },
      owner: null,
      moderation: null,
    });
    mockDownloadZip.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: {
        demo: { version: "1.0.0", installedAt: 100 },
      },
    });
    vi.mocked(readSkillOrigin).mockResolvedValue({
      version: 1,
      registry: "https://clawhub.ai",
      slug: "demo",
      installedVersion: "1.0.0",
      installedAt: 100,
      fingerprint: "hash",
    });
    vi.mocked(writeLockfile).mockResolvedValue();
    vi.mocked(writeSkillOrigin).mockResolvedValue();
    vi.mocked(extractZipToDir).mockResolvedValue();
    vi.mocked(listTextFiles).mockResolvedValue([
      { relPath: "SKILL.md", bytes: new Uint8Array([1]) },
    ]);
    vi.mocked(hashSkillFiles).mockReturnValue({ fingerprint: "hash", files: [] });
    vi.mocked(stat).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof stat>>);
    vi.mocked(rm).mockResolvedValue();

    await cmdUpdate(makeOpts(), "demo", {}, false);

    const originInstalledAt = vi.mocked(writeSkillOrigin).mock.calls[0]?.[1]?.installedAt;
    const lockfileInstalledAt =
      vi.mocked(writeLockfile).mock.calls[0]?.[1]?.skills?.demo?.installedAt;
    expect(originInstalledAt).toBeDefined();
    expect(lockfileInstalledAt).toBeDefined();
    expect(originInstalledAt).toBe(lockfileInstalledAt);
  });
});

describe("pin commands", () => {
  it("pins an installed skill and preserves its version metadata", async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: "1.0.0", installedAt: 123 } },
    });
    vi.mocked(writeLockfile).mockResolvedValue();

    await cmdPin(makeOpts(), "demo", { reason: "scanner hold" });

    expect(writeLockfile).toHaveBeenCalledWith("/work", {
      version: 1,
      skills: {
        demo: {
          version: "1.0.0",
          installedAt: 123,
          pinned: true,
          pinReason: "scanner hold",
        },
      },
    });
    expect(mockLog).toHaveBeenCalledWith("Pinned demo: scanner hold");
  });

  it("reports when an installed skill is already pinned without changes", async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: {
        demo: { version: "1.0.0", installedAt: 123, pinned: true, pinReason: "scanner hold" },
      },
    });

    await cmdPin(makeOpts(), "demo");

    expect(writeLockfile).not.toHaveBeenCalled();
    expect(mockLog).toHaveBeenCalledWith('Skill "demo" is already pinned: scanner hold');
  });

  it("unpinned skills clear pin metadata and keep the installed version", async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: {
        demo: { version: "1.0.0", installedAt: 123, pinned: true, pinReason: "scanner hold" },
      },
    });
    vi.mocked(writeLockfile).mockResolvedValue();

    await cmdUnpin(makeOpts(), "demo");

    expect(writeLockfile).toHaveBeenCalledWith("/work", {
      version: 1,
      skills: {
        demo: {
          version: "1.0.0",
          installedAt: 123,
        },
      },
    });
    expect(mockLog).toHaveBeenCalledWith("Unpinned demo");
  });
});

describe("cmdList", () => {
  it("shows pinned state in list output", async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: {
        demo: { version: "1.0.0", installedAt: 123, pinned: true, pinReason: "scanner hold" },
        other: { version: "2.0.0", installedAt: 456 },
      },
    });

    await cmdList(makeOpts());

    expect(mockLog).toHaveBeenCalledWith("demo  1.0.0  pinned (scanner hold)");
    expect(mockLog).toHaveBeenCalledWith("other  2.0.0");
  });
});

describe("cmdInstall", () => {
  it("passes optional auth token to API + download requests", async () => {
    mockGetOptionalAuthToken.mockResolvedValue("tkn");
    mockApiRequest.mockImplementation(async (_registry, args) => {
      if (args.path === LegacyApiRoutes.cliTelemetryInstall) return { ok: true };
      return {
        skill: {
          slug: "demo",
          displayName: "Demo",
          summary: null,
          tags: {},
          stats: {},
          createdAt: 0,
          updatedAt: 0,
        },
        latestVersion: { version: "1.0.0" },
        owner: null,
        moderation: null,
      };
    });
    mockDownloadZip.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(readLockfile).mockResolvedValue({ version: 1, skills: {} });
    vi.mocked(writeLockfile).mockResolvedValue();
    vi.mocked(writeSkillOrigin).mockResolvedValue();
    vi.mocked(extractZipToDir).mockResolvedValue();
    vi.mocked(stat).mockRejectedValue(new Error("missing"));
    vi.mocked(rm).mockResolvedValue();

    await cmdInstall(makeOpts(), "demo");

    const [, requestArgs] = mockApiRequest.mock.calls[0] ?? [];
    expect(requestArgs?.token).toBe("tkn");
    const [, zipArgs] = mockDownloadZip.mock.calls[0] ?? [];
    expect(zipArgs?.token).toBe("tkn");
    expect(mockApiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: LegacyApiRoutes.cliTelemetryInstall,
        token: "tkn",
        body: {
          event: "install",
          slug: "demo",
          version: "1.0.0",
          rootId: expect.any(String),
          rootLabel: expect.any(String),
        },
      }),
      expect.anything(),
    );
  });

  it("does not fail installs when install telemetry fails", async () => {
    mockGetOptionalAuthToken.mockResolvedValue("tkn");
    mockApiRequest.mockImplementation(async (_registry, args) => {
      if (args.path === LegacyApiRoutes.cliTelemetryInstall) throw new Error("telemetry down");
      return {
        skill: {
          slug: "demo",
          displayName: "Demo",
          summary: null,
          tags: {},
          stats: {},
          createdAt: 0,
          updatedAt: 0,
        },
        latestVersion: { version: "1.0.0" },
        owner: null,
        moderation: null,
      };
    });
    mockDownloadZip.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(readLockfile).mockResolvedValue({ version: 1, skills: {} });
    vi.mocked(writeLockfile).mockResolvedValue();
    vi.mocked(writeSkillOrigin).mockResolvedValue();
    vi.mocked(extractZipToDir).mockResolvedValue();
    vi.mocked(stat).mockRejectedValue(new Error("missing"));

    await expect(cmdInstall(makeOpts(), "demo")).resolves.toBeUndefined();

    expect(writeLockfile).toHaveBeenCalled();
  });

  it("installs source-backed skills from the GitHub resolver response", async () => {
    const commit = "a".repeat(40);
    mockGetOptionalAuthToken.mockResolvedValue("tkn");
    mockApiRequest
      .mockResolvedValueOnce({
        skill: {
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
          summary: null,
          tags: {},
          stats: {},
          createdAt: 0,
          updatedAt: 0,
        },
        latestVersion: null,
        owner: null,
        moderation: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        slug: "aiq-deploy",
        installKind: "github",
        github: {
          repo: "NVIDIA/skills",
          path: "skills/aiq-deploy",
          commit,
          contentHash: "hash-aiq-deploy",
          sourceUrl: `https://github.com/NVIDIA/skills/tree/${commit}/skills/aiq-deploy`,
        },
      });
    mockFetchBinary.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(readLockfile).mockResolvedValue({ version: 1, skills: {} });
    vi.mocked(writeLockfile).mockResolvedValue();
    vi.mocked(writeSkillOrigin).mockResolvedValue();
    vi.mocked(extractGitHubZipPathToDir).mockResolvedValue();
    vi.mocked(listTextFiles).mockResolvedValue([
      { relPath: "SKILL.md", bytes: new Uint8Array([1]) },
    ]);
    vi.mocked(hashSkillFiles).mockReturnValue({ fingerprint: "hash", files: [] });
    vi.mocked(stat).mockRejectedValue(new Error("missing"));

    await cmdInstall(makeOpts(), "aiq-deploy");

    expect(mockApiRequest).toHaveBeenNthCalledWith(
      2,
      "https://clawhub.ai",
      {
        method: "GET",
        path: `${ApiRoutes.skills}/${encodeURIComponent("aiq-deploy")}/install`,
        token: "tkn",
        acceptedStatuses: [403, 409, 410, 423],
      },
      expect.anything(),
    );
    expect(mockDownloadZip).not.toHaveBeenCalled();
    expect(mockFetchBinary).toHaveBeenCalledWith("https://clawhub.ai", {
      url: `https://codeload.github.com/NVIDIA/skills/zip/${commit}`,
    });
    expect(extractGitHubZipPathToDir).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      "/work/skills/aiq-deploy",
      "skills/aiq-deploy",
    );
    expect(writeSkillOrigin).toHaveBeenCalledWith("/work/skills/aiq-deploy", {
      version: 1,
      registry: "https://clawhub.ai",
      slug: "aiq-deploy",
      installedVersion: commit,
      installedAt: expect.any(Number),
      fingerprint: "hash",
    });
    expect(writeLockfile).toHaveBeenCalledWith("/work", {
      version: 1,
      skills: {
        "aiq-deploy": { version: commit, installedAt: expect.any(Number) },
      },
    });
  });

  it("passes force-install to source-backed install resolution", async () => {
    const commit = "a".repeat(40);
    mockGetOptionalAuthToken.mockResolvedValue("tkn");
    mockApiRequest
      .mockResolvedValueOnce({
        skill: {
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
          summary: null,
          tags: {},
          stats: {},
          createdAt: 0,
          updatedAt: 0,
        },
        latestVersion: null,
        owner: null,
        moderation: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        slug: "aiq-deploy",
        installKind: "github",
        github: {
          repo: "NVIDIA/skills",
          path: "skills/aiq-deploy",
          commit,
          contentHash: "hash-aiq-deploy",
          sourceUrl: `https://github.com/NVIDIA/skills/tree/${commit}/skills/aiq-deploy`,
        },
      });
    mockFetchBinary.mockResolvedValue(new Uint8Array([1, 2, 3]));

    await cmdInstall(makeOpts(), "aiq-deploy", undefined, false, true);

    expect(mockApiRequest).toHaveBeenNthCalledWith(
      2,
      "https://clawhub.ai",
      expect.objectContaining({
        method: "GET",
        path: `${ApiRoutes.skills}/${encodeURIComponent("aiq-deploy")}/install?forceInstall=1`,
        token: "tkn",
      }),
      expect.anything(),
    );
  });

  it("blocks force reinstall when a skill is pinned", async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: "0.9.0", installedAt: 123, pinned: true, pinReason: "hold" } },
    });
    vi.mocked(stat).mockRejectedValue(new Error("missing"));

    await expect(cmdInstall(makeOpts(), "demo", undefined, true)).rejects.toThrow(/is pinned/i);

    expect(mockApiRequest).not.toHaveBeenCalled();
    expect(mockDownloadZip).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
    expect(writeLockfile).not.toHaveBeenCalled();
  });

  it("does not rm local directory when skill is malware-blocked (--force)", async () => {
    vi.mocked(stat).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof stat>>); // target exists
    mockApiRequest.mockResolvedValue({
      skill: {
        slug: "demo",
        displayName: "Demo",
        summary: null,
        tags: {},
        stats: {},
        createdAt: 0,
        updatedAt: 0,
      },
      latestVersion: { version: "1.0.0" },
      owner: null,
      moderation: { isMalwareBlocked: true, isSuspicious: false },
    });

    await expect(cmdInstall(makeOpts(), "demo", undefined, true)).rejects.toThrow(/malware/i);

    expect(rm).not.toHaveBeenCalled();
  });

  it("does not rm local directory when API fetch fails (--force)", async () => {
    vi.mocked(stat).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof stat>>); // target exists
    mockApiRequest.mockRejectedValue(new Error("Skill not found"));

    await expect(cmdInstall(makeOpts(), "demo", undefined, true)).rejects.toThrow(/not found/i);

    expect(rm).not.toHaveBeenCalled();
  });

  it("does not rm local directory when requested version lookup fails (--force)", async () => {
    vi.mocked(stat).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof stat>>); // target exists
    mockApiRequest
      .mockResolvedValueOnce({
        skill: {
          slug: "demo",
          displayName: "Demo",
          summary: null,
          tags: {},
          stats: {},
          createdAt: 0,
          updatedAt: 0,
        },
        latestVersion: { version: "1.0.0" },
        owner: null,
        moderation: null,
      })
      .mockRejectedValueOnce(new Error("Version not found"));

    await expect(cmdInstall(makeOpts(), "demo", "9.9.9", true)).rejects.toThrow(
      /version not found/i,
    );

    expect(rm).not.toHaveBeenCalled();
    expect(mockApiRequest).toHaveBeenNthCalledWith(
      2,
      "https://clawhub.ai",
      expect.objectContaining({
        path: `${ApiRoutes.skills}/${encodeURIComponent("demo")}/versions/${encodeURIComponent("9.9.9")}`,
      }),
      expect.anything(),
    );
  });

  it("validates requested version before rm when all checks pass (--force)", async () => {
    vi.mocked(stat).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof stat>>); // target exists
    mockApiRequest
      .mockResolvedValueOnce({
        skill: {
          slug: "demo",
          displayName: "Demo",
          summary: null,
          tags: {},
          stats: {},
          createdAt: 0,
          updatedAt: 0,
        },
        latestVersion: { version: "1.0.0" },
        owner: null,
        moderation: null,
      })
      .mockResolvedValueOnce({
        version: {
          version: "9.9.9",
          createdAt: 0,
          changelog: "",
          changelogSource: null,
          license: null,
          files: [],
        },
        skill: { slug: "demo", displayName: "Demo" },
      });
    mockDownloadZip.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(readLockfile).mockResolvedValue({ version: 1, skills: {} });
    vi.mocked(writeLockfile).mockResolvedValue();
    vi.mocked(writeSkillOrigin).mockResolvedValue();
    vi.mocked(extractZipToDir).mockResolvedValue();
    vi.mocked(rm).mockResolvedValue();

    await cmdInstall(makeOpts(), "demo", "9.9.9", true);

    expect(rm).toHaveBeenCalledWith("/work/skills/demo", { recursive: true, force: true });
    expect(mockDownloadZip).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({ slug: "demo", version: "9.9.9" }),
    );
    const versionLookupOrder = mockApiRequest.mock.invocationCallOrder[1];
    const rmOrder = vi.mocked(rm).mock.invocationCallOrder[0];
    const downloadOrder = mockDownloadZip.mock.invocationCallOrder[0];
    expect(versionLookupOrder).toBeLessThan(rmOrder);
    expect(rmOrder).toBeLessThan(downloadOrder);
  });

  it("calls rm before download when all checks pass (--force)", async () => {
    vi.mocked(stat).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof stat>>); // target exists
    mockApiRequest.mockResolvedValue({
      skill: {
        slug: "demo",
        displayName: "Demo",
        summary: null,
        tags: {},
        stats: {},
        createdAt: 0,
        updatedAt: 0,
      },
      latestVersion: { version: "1.0.0" },
      owner: null,
      moderation: null,
    });
    mockDownloadZip.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(readLockfile).mockResolvedValue({ version: 1, skills: {} });
    vi.mocked(writeLockfile).mockResolvedValue();
    vi.mocked(writeSkillOrigin).mockResolvedValue();
    vi.mocked(extractZipToDir).mockResolvedValue();
    vi.mocked(rm).mockResolvedValue();

    await cmdInstall(makeOpts(), "demo", undefined, true);

    expect(rm).toHaveBeenCalledWith("/work/skills/demo", { recursive: true, force: true });
    expect(mockDownloadZip).toHaveBeenCalled();
    const rmOrder = vi.mocked(rm).mock.invocationCallOrder[0];
    const downloadOrder = mockDownloadZip.mock.invocationCallOrder[0];
    expect(rmOrder).toBeLessThan(downloadOrder);
  });

  it("writes identical installedAt to origin and lockfile on install", async () => {
    mockApiRequest.mockImplementation(async (_registry, args) => {
      if (args.path === LegacyApiRoutes.cliTelemetryInstall) return { ok: true };
      return {
        skill: {
          slug: "demo",
          displayName: "Demo",
          summary: null,
          tags: {},
          stats: {},
          createdAt: 0,
          updatedAt: 0,
        },
        latestVersion: { version: "1.0.0" },
        owner: null,
        moderation: null,
      };
    });
    mockDownloadZip.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(readLockfile).mockResolvedValue({ version: 1, skills: {} });
    vi.mocked(writeLockfile).mockResolvedValue();
    vi.mocked(writeSkillOrigin).mockResolvedValue();
    vi.mocked(extractZipToDir).mockResolvedValue();
    vi.mocked(listTextFiles).mockResolvedValue([
      { relPath: "SKILL.md", bytes: new Uint8Array([1]) },
    ]);
    vi.mocked(hashSkillFiles).mockReturnValue({ fingerprint: "hash", files: [] });
    vi.mocked(stat).mockRejectedValue(new Error("missing"));
    vi.mocked(rm).mockResolvedValue();

    await cmdInstall(makeOpts(), "demo");

    const originInstalledAt = vi.mocked(writeSkillOrigin).mock.calls[0]?.[1]?.installedAt;
    const lockfileInstalledAt =
      vi.mocked(writeLockfile).mock.calls[0]?.[1]?.skills?.demo?.installedAt;
    expect(originInstalledAt).toBeDefined();
    expect(lockfileInstalledAt).toBeDefined();
    expect(originInstalledAt).toBe(lockfileInstalledAt);
  });
});

describe("cmdUninstall", () => {
  it("requires --yes when input is disabled", async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: "1.0.0", installedAt: 123 } },
    });

    await expect(cmdUninstall(makeOpts(), "demo", {}, false)).rejects.toThrow(/--yes/i);
  });

  it("prompts when interactive and proceeds on confirm", async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: "1.0.0", installedAt: 123 } },
    });
    vi.mocked(writeLockfile).mockResolvedValue();
    vi.mocked(rm).mockResolvedValue();
    mockIsInteractive.mockReturnValue(true);
    mockPromptConfirm.mockResolvedValue(true);

    await cmdUninstall(makeOpts(), "demo", {}, true);

    expect(mockPromptConfirm).toHaveBeenCalledWith("Uninstall demo?");
    expect(rm).toHaveBeenCalledWith("/work/skills/demo", { recursive: true, force: true });
    expect(writeLockfile).toHaveBeenCalled();
  });

  it("prints Cancelled and does not remove when prompt declines", async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: "1.0.0", installedAt: 123 } },
    });
    mockIsInteractive.mockReturnValue(true);
    mockPromptConfirm.mockResolvedValue(false);

    await cmdUninstall(makeOpts(), "demo", {}, true);

    expect(mockLog).toHaveBeenCalledWith("Cancelled.");
    expect(rm).not.toHaveBeenCalled();
    expect(writeLockfile).not.toHaveBeenCalled();
  });

  it("rejects unsafe slugs", async () => {
    await expect(cmdUninstall(makeOpts(), "../evil", { yes: true }, false)).rejects.toThrow(
      /invalid slug/i,
    );
    await expect(cmdUninstall(makeOpts(), "demo/evil", { yes: true }, false)).rejects.toThrow(
      /invalid slug/i,
    );
  });

  it("fails when skill is not installed", async () => {
    vi.mocked(readLockfile).mockResolvedValue({ version: 1, skills: {} });

    await expect(cmdUninstall(makeOpts(), "missing", {}, false)).rejects.toThrow(
      "Not installed: missing",
    );
  });

  it("removes skill directory and lockfile entry with --yes flag", async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: "1.0.0", installedAt: 123 } },
    });
    vi.mocked(writeLockfile).mockResolvedValue();
    vi.mocked(rm).mockResolvedValue();

    await cmdUninstall(makeOpts(), "demo", { yes: true }, false);

    expect(rm).toHaveBeenCalledWith("/work/skills/demo", { recursive: true, force: true });
    expect(writeLockfile).toHaveBeenCalledWith("/work", {
      version: 1,
      skills: {},
    });
    expect(mockSpinner.succeed).toHaveBeenCalledWith("Uninstalled demo");
  });

  it("does not update lockfile if remove fails", async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: "1.0.0", installedAt: 123 } },
    });
    vi.mocked(rm).mockRejectedValue(new Error("nope"));

    await expect(cmdUninstall(makeOpts(), "demo", { yes: true }, false)).rejects.toThrow("nope");

    expect(writeLockfile).not.toHaveBeenCalled();
  });

  it("updates lockfile after removing directory", async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: "1.0.0", installedAt: 123 } },
    });
    vi.mocked(writeLockfile).mockResolvedValue();
    vi.mocked(rm).mockResolvedValue();

    await cmdUninstall(makeOpts(), "demo", { yes: true }, false);

    const rmCallMock = vi.mocked(rm);
    const writeLockfileCallMock = vi.mocked(writeLockfile);
    expect(rmCallMock.mock.invocationCallOrder[0]).toBeLessThan(
      writeLockfileCallMock.mock.invocationCallOrder[0],
    );
  });

  it("removes skill and updates lockfile keeping other skills", async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: {
        demo: { version: "1.0.0", installedAt: 123 },
        other: { version: "2.0.0", installedAt: 456 },
      },
    });
    vi.mocked(writeLockfile).mockResolvedValue();
    vi.mocked(rm).mockResolvedValue();

    await cmdUninstall(makeOpts(), "demo", { yes: true }, false);

    expect(rm).toHaveBeenCalledWith("/work/skills/demo", { recursive: true, force: true });
    expect(writeLockfile).toHaveBeenCalledWith("/work", {
      version: 1,
      skills: { other: { version: "2.0.0", installedAt: 456 } },
    });
  });

  it("trims slug whitespace", async () => {
    vi.mocked(readLockfile).mockResolvedValue({
      version: 1,
      skills: { demo: { version: "1.0.0", installedAt: 123 } },
    });
    vi.mocked(writeLockfile).mockResolvedValue();
    vi.mocked(rm).mockResolvedValue();

    await cmdUninstall(makeOpts(), "  demo  ", { yes: true }, false);

    expect(rm).toHaveBeenCalledWith("/work/skills/demo", { recursive: true, force: true });
  });
});
