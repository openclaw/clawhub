/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthTokenModuleMocks,
  createHttpModuleMocks,
  createRegistryModuleMocks,
  createUiModuleMocks,
  makeGlobalOpts,
} from "../../../test/cliCommandTestKit.js";

const mockIntro = vi.fn();
const mockOutro = vi.fn();
const mockLog = vi.fn();
const mockMultiselect = vi.fn(async (_args?: unknown) => [] as string[]);
let interactive = false;
const mocked = <T>(value: T) =>
  value as T & { mockImplementation: (...args: unknown[]) => unknown };

const defaultFindSkillFolders = async (root: string) => {
  if (!root.endsWith("/scan")) return [];
  return [
    { folder: "/scan/new-skill", slug: "new-skill", displayName: "New Skill" },
    { folder: "/scan/synced-skill", slug: "synced-skill", displayName: "Synced Skill" },
    { folder: "/scan/update-skill", slug: "update-skill", displayName: "Update Skill" },
  ];
};

vi.mock("@clack/prompts", () => ({
  intro: (value: string) => mockIntro(value),
  outro: (value: string) => mockOutro(value),
  multiselect: (args: unknown) => mockMultiselect(args),
  text: vi.fn(async () => ""),
  isCancel: () => false,
}));

const authTokenMocks = createAuthTokenModuleMocks();
const registryMocks = createRegistryModuleMocks();
const httpMocks = createHttpModuleMocks();
const uiMocks = createUiModuleMocks();
httpMocks.downloadZip.mockImplementation(
  async (_registry?: unknown, _args?: unknown) => new Uint8Array([1, 2, 3]),
);
const mockApiRequest = httpMocks.apiRequest;
const mockFail = uiMocks.fail;
const mockSpinner = uiMocks.spinner;
vi.mock("../authToken.js", () => authTokenMocks.moduleFactory());
vi.mock("../registry.js", () => registryMocks.moduleFactory());
vi.mock("../../http.js", () => httpMocks.moduleFactory());
vi.mock("../ui.js", () => ({
  createSpinner: vi.fn(() => mockSpinner),
  fail: (message: string) => mockFail(message),
  formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  isInteractive: () => interactive,
  promptConfirm: uiMocks.promptConfirm,
}));

vi.mock("../scanSkills.js", () => ({
  findSkillFolders: vi.fn(defaultFindSkillFolders),
  getFallbackSkillRoots: vi.fn(() => []),
}));

const mockResolveClawdbotSkillRoots = vi.fn(
  async () =>
    ({
      roots: [] as string[],
      labels: {} as Record<string, string>,
    }) as const,
);
vi.mock("../clawdbotConfig.js", () => ({
  resolveClawdbotSkillRoots: () => mockResolveClawdbotSkillRoots(),
}));

const mockListTextFiles = vi.fn(async (folder: string) => [
  { relPath: "SKILL.md", bytes: new TextEncoder().encode(folder) },
]);
const mockHashSkillFiles = vi.fn((files: Array<{ relPath: string; bytes: Uint8Array }>) => ({
  fingerprint: files
    .map((file) => `${file.relPath}:${Buffer.from(file.bytes).toString("hex")}`)
    .join("|"),
  files: [],
}));
const mockHashSkillZip = vi.fn((_zip?: Uint8Array) => ({
  fingerprint: "remote-fingerprint",
  files: [],
}));
const mockReadSkillOrigin = vi.fn(async (_folder?: string) => null);
vi.mock("../../skills.js", () => ({
  listTextFiles: (folder: string) => mockListTextFiles(folder),
  hashSkillFiles: (files: Array<{ relPath: string; bytes: Uint8Array }>) =>
    mockHashSkillFiles(files),
  hashSkillZip: (zip: Uint8Array) => mockHashSkillZip(zip),
  readSkillOrigin: (folder: string) => mockReadSkillOrigin(folder),
}));

const mockCmdPublish = vi.fn();
vi.mock("./publish.js", () => ({
  cmdPublish: (opts: unknown, folder: unknown, options?: unknown) =>
    mockCmdPublish(opts, folder, options),
}));

const { cmdSync } = await import("./sync");

function makeOpts() {
  return makeGlobalOpts();
}

afterEach(async () => {
  vi.clearAllMocks();
  mockCmdPublish.mockReset();
  process.exitCode = undefined;
  const { findSkillFolders } = await import("../scanSkills.js");
  mocked(findSkillFolders).mockImplementation(defaultFindSkillFolders);
});

vi.spyOn(console, "log").mockImplementation((...args) => {
  mockLog(args.map(String).join(" "));
});
describe("cmdSync", () => {
  it("classifies skills as new/update/synced (dry-run, mocked HTTP)", async () => {
    interactive = false;
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path === "/api/cli/telemetry/install") return { ok: true };
      if (args.path.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "new-skill") {
          throw new Error("Skill not found");
        }
        if (slug === "synced-skill") {
          return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
        }
        if (slug === "update-skill") {
          return { match: null, latestVersion: { version: "1.0.0" } };
        }
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`);
    });

    await cmdSync(makeOpts(), { root: ["/scan"], all: true, dryRun: true }, true);

    expect(mockCmdPublish).not.toHaveBeenCalled();

    const output = mockLog.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toMatch(/Already synced/);
    expect(output).toMatch(/synced-skill/);

    const dryRunOutro = mockOutro.mock.calls.at(-1)?.[0];
    expect(String(dryRunOutro)).toMatch(/Dry run: would upload 2 skill/);
  });

  it("emits CI JSON dry-run without requiring auth", async () => {
    interactive = false;
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "new-skill") {
          throw new Error("Skill not found");
        }
        if (slug === "synced-skill") {
          return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
        }
        if (slug === "update-skill") {
          return { match: null, latestVersion: { version: "1.0.0" } };
        }
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`);
    });

    let output = "";
    try {
      await cmdSync(
        makeOpts(),
        {
          root: ["/scan"],
          all: true,
          dryRun: true,
          json: true,
          owner: "nvidia",
          sourceRepo: "NVIDIA/skills",
          sourceCommit: "abc123",
          sourceRef: "refs/heads/main",
        },
        false,
      );
      output = String(stdoutWrite.mock.calls.at(-1)?.[0] ?? "").trim();
    } finally {
      stdoutWrite.mockRestore();
    }

    expect(authTokenMocks.requireAuthToken).not.toHaveBeenCalled();
    expect(mockCmdPublish).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
    expect(mockIntro).not.toHaveBeenCalled();
    expect(mockOutro).not.toHaveBeenCalled();

    const parsed = JSON.parse(output) as {
      ok: boolean;
      dryRun: boolean;
      owner?: string;
      summary: { wouldPublish: number; alreadySynced: number; failed: number };
      wouldPublish: Array<{
        slug: string;
        version: string;
        status: string;
        source?: { repo: string };
      }>;
      alreadySynced: Array<{ slug: string; version: string }>;
      published: unknown[];
      failed: unknown[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.owner).toBe("nvidia");
    expect(parsed.summary).toMatchObject({ wouldPublish: 2, alreadySynced: 1, failed: 0 });
    expect(parsed.wouldPublish.map((entry) => [entry.slug, entry.version, entry.status])).toEqual([
      ["new-skill", "1.0.0", "new"],
      ["update-skill", "1.0.1", "update"],
    ]);
    expect(parsed.wouldPublish[0]?.source?.repo).toBe("NVIDIA/skills");
    expect(parsed.alreadySynced).toEqual([
      expect.objectContaining({ slug: "synced-skill", version: "1.2.3" }),
    ]);
    expect(parsed.published).toEqual([]);
    expect(parsed.failed).toEqual([]);
  });

  it("prints bullet lists and selects all actionable by default", async () => {
    interactive = true;
    mockMultiselect.mockImplementation(async (args?: unknown) => {
      const { initialValues } = args as { initialValues: string[] };
      return initialValues;
    });
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path === "/api/cli/telemetry/install") return { ok: true };
      if (args.path.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "new-skill") {
          throw new Error("Skill not found");
        }
        if (slug === "synced-skill") {
          return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
        }
        if (slug === "update-skill") {
          return { match: null, latestVersion: { version: "1.0.0" } };
        }
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`);
    });

    await cmdSync(makeOpts(), { root: ["/scan"], all: false, dryRun: false, bump: "patch" }, true);

    const output = mockLog.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toMatch(/To sync/);
    expect(output).toMatch(/- new-skill/);
    expect(output).toMatch(/- update-skill/);
    expect(output).toMatch(/Already synced/);
    expect(output).toMatch(/- synced-skill/);

    const lastCall = mockMultiselect.mock.calls.at(-1);
    const promptArgs = lastCall ? (lastCall[0] as { initialValues: string[] }) : undefined;
    expect(promptArgs?.initialValues.length).toBe(2);
    expect(mockCmdPublish).toHaveBeenCalledTimes(2);
  });

  it("passes owner and source provenance into real bulk publishes", async () => {
    interactive = false;
    const opts = makeGlobalOpts("/repo");
    const { findSkillFolders } = await import("../scanSkills.js");
    mocked(findSkillFolders).mockImplementation(async (root: string) => {
      if (root !== "/repo/skills") return [];
      return [
        { folder: "/repo/skills/new-skill", slug: "new-skill", displayName: "New Skill" },
        { folder: "/repo/skills/update-skill", slug: "update-skill", displayName: "Update Skill" },
      ];
    });
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "mikehollinger" } };
      if (args.path === "/api/cli/telemetry/install") return { ok: true };
      if (args.path.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "new-skill") throw new Error("Skill not found");
        if (slug === "update-skill") {
          return { match: null, latestVersion: { version: "1.0.0" } };
        }
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`);
    });

    await cmdSync(
      opts,
      {
        root: ["/repo/skills"],
        all: true,
        dryRun: false,
        owner: "nvidia",
        tags: "latest,catalog",
        sourceRepo: "https://github.com/NVIDIA/skills",
        sourceCommit: "abc123",
        sourceRef: "refs/heads/main",
      },
      false,
    );

    expect(mockCmdPublish).toHaveBeenCalledTimes(2);
    expect(mockCmdPublish.mock.calls.map((call) => call[2])).toEqual([
      expect.objectContaining({
        slug: "new-skill",
        owner: "nvidia",
        version: "1.0.0",
        tags: "latest,catalog",
        sourceRepo: "https://github.com/NVIDIA/skills",
        sourceCommit: "abc123",
        sourceRef: "refs/heads/main",
        sourcePath: "skills/new-skill",
      }),
      expect.objectContaining({
        slug: "update-skill",
        owner: "nvidia",
        version: "1.0.1",
        tags: "latest,catalog",
        sourceRepo: "https://github.com/NVIDIA/skills",
        sourceCommit: "abc123",
        sourceRef: "refs/heads/main",
        sourcePath: "skills/update-skill",
      }),
    ]);
  });

  it("uses dot source path for a root skill publish", async () => {
    interactive = false;
    const opts = makeGlobalOpts("/repo");
    const { findSkillFolders } = await import("../scanSkills.js");
    mocked(findSkillFolders).mockImplementation(async (root: string) => {
      if (root !== "/repo") return [];
      return [{ folder: "/repo", slug: "root-skill", displayName: "Root Skill" }];
    });
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "mikehollinger" } };
      if (args.path === "/api/cli/telemetry/install") return { ok: true };
      if (args.path.startsWith("/api/v1/resolve?")) {
        throw new Error("Skill not found");
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`);
    });

    await cmdSync(
      opts,
      {
        all: true,
        dryRun: false,
        sourceRepo: "NVIDIA/root-skill",
        sourceCommit: "abc123",
      },
      false,
    );

    expect(mockCmdPublish).toHaveBeenCalledTimes(1);
    expect(mockCmdPublish.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        slug: "root-skill",
        sourcePath: ".",
      }),
    );
  });

  it("labels unmatched local content as proposed publish versions, not registry updates", async () => {
    interactive = false;
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path === "/api/cli/telemetry/install") return { ok: true };
      if (args.path.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "new-skill") {
          throw new Error("Skill not found");
        }
        if (slug === "synced-skill") {
          return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
        }
        if (slug === "update-skill") {
          return { match: null, latestVersion: { version: "1.0.0" } };
        }
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`);
    });

    await cmdSync(makeOpts(), { root: ["/scan"], all: true, dryRun: true }, true);

    const output = mockLog.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toMatch(/update-skill\s+LOCAL CHANGES latest 1\.0\.0; publish 1\.0\.1/);
    expect(output).toMatch(/new-skill\s+NEW \(publish 1\.0\.0\)/);
    expect(output).not.toMatch(/UPDATE 1\.0\.0/);
  });

  it("shows condensed synced list when nothing to sync", async () => {
    interactive = false;
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path === "/api/cli/telemetry/install") return { ok: true };
      if (args.path.startsWith("/api/v1/resolve?")) {
        return { match: { version: "1.0.0" }, latestVersion: { version: "1.0.0" } };
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`);
    });

    await cmdSync(makeOpts(), { root: ["/scan"], all: true, dryRun: false }, true);

    const output = mockLog.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toMatch(/Already synced/);
    expect(output).toMatch(/new-skill@1.0.0/);
    expect(output).toMatch(/synced-skill@1.0.0/);
    expect(output).not.toMatch(/\n-/);

    const outro = mockOutro.mock.calls.at(-1)?.[0];
    expect(String(outro)).toMatch(/Nothing to sync/);
  });

  it("dedupes duplicate slugs before publishing", async () => {
    interactive = false;
    const { findSkillFolders } = await import("../scanSkills.js");
    mocked(findSkillFolders).mockImplementation(async (root: string) => {
      if (!root.endsWith("/scan")) return [];
      return [
        { folder: "/scan/dup-skill", slug: "dup-skill", displayName: "Dup Skill" },
        { folder: "/scan/dup-skill-copy", slug: "dup-skill", displayName: "Dup Skill" },
      ];
    });

    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path === "/api/cli/telemetry/install") return { ok: true };
      if (args.path.startsWith("/api/v1/resolve?")) {
        return { match: null, latestVersion: null };
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`);
    });

    await cmdSync(makeOpts(), { root: ["/scan"], all: true, dryRun: false }, true);

    expect(mockCmdPublish).toHaveBeenCalledTimes(1);
    const output = mockLog.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toMatch(/Skipped duplicate slugs/);
    expect(output).toMatch(/dup-skill/);
  });

  it("prints labeled roots when clawdbot roots are detected", async () => {
    interactive = false;
    mockResolveClawdbotSkillRoots.mockResolvedValueOnce({
      roots: ["/auto"],
      labels: { "/auto": "Agent: Work" },
    });
    const { findSkillFolders } = await import("../scanSkills.js");
    mocked(findSkillFolders).mockImplementation(async (root: string) => {
      if (root === "/auto") {
        return [{ folder: "/auto/alpha", slug: "alpha", displayName: "Alpha" }];
      }
      return [];
    });
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path === "/api/cli/telemetry/install") return { ok: true };
      if (args.path.startsWith("/api/v1/resolve?")) {
        throw new Error("Skill not found");
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`);
    });

    await cmdSync(makeOpts(), { all: true, dryRun: true }, true);

    const output = mockLog.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toMatch(/Roots with skills/);
    expect(output).toMatch(/Agent: Work/);
  });

  it("can disable auto-discovered clawdbot roots for CI exact scans", async () => {
    interactive = false;
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const scannedRoots: string[] = [];
    const { findSkillFolders } = await import("../scanSkills.js");
    mocked(findSkillFolders).mockImplementation(async (root: string) => {
      scannedRoots.push(root);
      if (root === "/scan") {
        return [{ folder: "/scan/ci-skill", slug: "ci-skill", displayName: "CI Skill" }];
      }
      if (root === "/auto") {
        return [{ folder: "/auto/auto-skill", slug: "auto-skill", displayName: "Auto Skill" }];
      }
      return [];
    });
    mockResolveClawdbotSkillRoots.mockResolvedValueOnce({
      roots: ["/auto"],
      labels: { "/auto": "Agent: Work" },
    });
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path.startsWith("/api/v1/resolve?")) {
        throw new Error("Skill not found");
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`);
    });

    let output = "";
    try {
      await cmdSync(
        makeOpts(),
        { root: ["/scan"], all: true, dryRun: true, json: true, clawdbotRoots: false },
        false,
      );
      output = String(stdoutWrite.mock.calls.at(-1)?.[0] ?? "").trim();
    } finally {
      stdoutWrite.mockRestore();
    }

    expect(mockResolveClawdbotSkillRoots).not.toHaveBeenCalled();
    expect(scannedRoots).not.toContain("/auto");
    const parsed = JSON.parse(output) as {
      roots: string[];
      wouldPublish: Array<{ slug: string }>;
    };
    expect(parsed.roots).toEqual(["/work", "/work/skills", "/scan"]);
    expect(parsed.wouldPublish.map((entry) => entry.slug)).toEqual(["ci-skill"]);
  });

  it("does not fall back to ambient roots when exact CI scans find no skills", async () => {
    interactive = false;
    const { findSkillFolders, getFallbackSkillRoots } = await import("../scanSkills.js");
    mocked(findSkillFolders).mockImplementation(async () => []);

    await expect(
      cmdSync(
        makeOpts(),
        { root: ["/scan"], all: true, dryRun: true, json: true, clawdbotRoots: false },
        false,
      ),
    ).rejects.toThrow("No skills found (checked configured roots)");

    expect(mockResolveClawdbotSkillRoots).not.toHaveBeenCalled();
    expect(getFallbackSkillRoots).not.toHaveBeenCalled();
  });

  it("allows empty changelog for updates (interactive)", async () => {
    interactive = true;
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path === "/api/cli/telemetry/install") return { ok: true };
      if (args.path.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "new-skill") {
          throw new Error("Skill not found");
        }
        if (slug === "synced-skill") {
          return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
        }
        if (slug === "update-skill") {
          return { match: null, latestVersion: { version: "1.0.0" } };
        }
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`);
    });

    await cmdSync(makeOpts(), { root: ["/scan"], all: true, dryRun: false, bump: "patch" }, true);

    const calls = mockCmdPublish.mock.calls.map(
      (call) => call[2] as { slug: string; changelog: string },
    );
    const update = calls.find((c) => c.slug === "update-skill");
    if (!update) throw new Error("Missing update-skill publish");
    expect(update.changelog).toBe("");
  });

  it("continues uploading after a publish failure", async () => {
    interactive = false;
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path === "/api/cli/telemetry/install") return { ok: true };
      if (args.path.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "new-skill") {
          throw new Error("Skill not found");
        }
        if (slug === "synced-skill") {
          return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
        }
        if (slug === "update-skill") {
          return { match: null, latestVersion: { version: "1.0.0" } };
        }
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`);
    });
    mockCmdPublish.mockImplementation(async (_opts, _folder, options?: unknown) => {
      const { slug } = options as { slug: string };
      if (slug === "new-skill") {
        throw new Error("Registry rejected upload");
      }
    });

    await cmdSync(makeOpts(), { root: ["/scan"], all: true, dryRun: false, bump: "patch" }, true);

    expect(mockCmdPublish).toHaveBeenCalledTimes(2);
    expect(mockCmdPublish.mock.calls.map((call) => (call[2] as { slug: string }).slug)).toEqual([
      "new-skill",
      "update-skill",
    ]);

    const output = mockLog.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toMatch(/Failed to upload/);
    expect(output).toMatch(/new-skill/);
    expect(output).toMatch(/Registry rejected upload/);

    const outro = mockOutro.mock.calls.at(-1)?.[0];
    expect(String(outro)).toMatch(/Uploaded 1 of 2 skill\(s\). 1 failed/);
    expect(process.exitCode).toBe(1);
  });

  it("continues uploading after an alias slug conflict publish failure", async () => {
    interactive = false;
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path === "/api/cli/telemetry/install") return { ok: true };
      if (args.path.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "new-skill") {
          throw new Error("Skill not found");
        }
        if (slug === "synced-skill") {
          return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
        }
        if (slug === "update-skill") {
          return { match: null, latestVersion: { version: "1.0.0" } };
        }
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`);
    });
    mockCmdPublish.mockImplementation(async (_opts, _folder, options?: unknown) => {
      const { slug } = options as { slug: string };
      if (slug === "new-skill") {
        throw new Error(
          "Slug redirects to an existing skill. Choose a different slug. Existing skill: /alice/demo",
        );
      }
    });

    await cmdSync(makeOpts(), { root: ["/scan"], all: true, dryRun: false, bump: "patch" }, true);

    expect(mockCmdPublish).toHaveBeenCalledTimes(2);
    expect(mockCmdPublish.mock.calls.map((call) => (call[2] as { slug: string }).slug)).toEqual([
      "new-skill",
      "update-skill",
    ]);

    const output = mockLog.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toMatch(/Failed to upload/);
    expect(output).toMatch(/Slug redirects to an existing skill/);
    expect(output).toMatch(/Existing skill: \/alice\/demo/);

    const outro = mockOutro.mock.calls.at(-1)?.[0];
    expect(String(outro)).toMatch(/Uploaded 1 of 2 skill\(s\). 1 failed/);
    expect(process.exitCode).toBe(1);
  });

  it("continues uploading after a locked slug publish failure", async () => {
    interactive = false;
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path === "/api/cli/telemetry/install") return { ok: true };
      if (args.path.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "new-skill") {
          throw new Error("Skill not found");
        }
        if (slug === "synced-skill") {
          return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
        }
        if (slug === "update-skill") {
          return { match: null, latestVersion: { version: "1.0.0" } };
        }
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`);
    });
    mockCmdPublish.mockImplementation(async (_opts, _folder, options?: unknown) => {
      const { slug } = options as { slug: string };
      if (slug === "new-skill") {
        throw new Error(
          "This slug is locked to a deleted or banned account. If you believe you are the rightful owner, open a GitHub issue to reclaim it: https://github.com/openclaw/clawhub/issues/new.",
        );
      }
    });

    await cmdSync(makeOpts(), { root: ["/scan"], all: true, dryRun: false, bump: "patch" }, true);

    expect(mockCmdPublish).toHaveBeenCalledTimes(2);
    expect(mockCmdPublish.mock.calls.map((call) => (call[2] as { slug: string }).slug)).toEqual([
      "new-skill",
      "update-skill",
    ]);

    const output = mockLog.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toMatch(/Failed to upload/);
    expect(output).toMatch(/This slug is locked to a deleted or banned account/);

    const outro = mockOutro.mock.calls.at(-1)?.[0];
    expect(String(outro)).toMatch(/Uploaded 1 of 2 skill\(s\). 1 failed/);
    expect(process.exitCode).toBe(1);
  });

  it("records unrelated publish failures as per-skill failures", async () => {
    interactive = false;
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path === "/api/cli/telemetry/install") return { ok: true };
      if (args.path.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "new-skill") {
          throw new Error("Skill not found");
        }
        if (slug === "synced-skill") {
          return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
        }
        if (slug === "update-skill") {
          return { match: null, latestVersion: { version: "1.0.0" } };
        }
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`);
    });
    mockCmdPublish.mockRejectedValueOnce(new Error("HTTP 500"));

    await cmdSync(makeOpts(), { root: ["/scan"], all: true, dryRun: false, bump: "patch" }, true);

    expect(mockCmdPublish).toHaveBeenCalledTimes(2);
    expect(mockCmdPublish.mock.calls.map((call) => (call[2] as { slug: string }).slug)).toEqual([
      "new-skill",
      "update-skill",
    ]);

    const output = mockLog.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toMatch(/Failed to upload/);
    expect(output).toMatch(/new-skill: HTTP 500/);

    const outro = mockOutro.mock.calls.at(-1)?.[0];
    expect(String(outro)).toMatch(/Uploaded 1 of 2 skill\(s\). 1 failed/);
    expect(process.exitCode).toBe(1);
  });

  it("aborts command-level failures before publishing", async () => {
    interactive = false;
    const { findSkillFolders } = await import("../scanSkills.js");
    mocked(findSkillFolders).mockImplementation(async (root: string) => {
      if (!root.endsWith("/scan")) return [];
      return [{ folder: "/scan/update-skill", slug: "update-skill", displayName: "Update Skill" }];
    });
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path === "/api/cli/telemetry/install") return { ok: true };
      if (args.path.startsWith("/api/v1/resolve?")) {
        return { match: null, latestVersion: { version: "1.0.0" } };
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`);
    });

    await expect(
      cmdSync(
        makeOpts(),
        { root: ["/scan"], all: true, dryRun: false, bump: "not-semver" as never },
        true,
      ),
    ).rejects.toThrow("Could not bump version for update-skill");

    expect(mockCmdPublish).not.toHaveBeenCalled();
  });

  it("does not report install telemetry from sync", async () => {
    interactive = false;
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path.startsWith("/api/v1/resolve?")) {
        return { match: { version: "1.0.0" }, latestVersion: { version: "1.0.0" } };
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`);
    });

    await cmdSync(makeOpts(), { root: ["/scan"], all: true, dryRun: true }, true);
    expect(
      mockApiRequest.mock.calls.some((call) => call[1]?.path === "/api/cli/telemetry/install"),
    ).toBe(false);
  });
});
