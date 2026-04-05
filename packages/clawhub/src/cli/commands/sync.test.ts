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
      if (args.path === "/api/cli/telemetry/sync") return { ok: true };
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

  it("prints bullet lists and selects all actionable by default", async () => {
    interactive = true;
    mockMultiselect.mockImplementation(async (args?: unknown) => {
      const { initialValues } = args as { initialValues: string[] };
      return initialValues;
    });
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path === "/api/cli/telemetry/sync") return { ok: true };
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

  it("shows condensed synced list when nothing to sync", async () => {
    interactive = false;
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path === "/api/cli/telemetry/sync") return { ok: true };
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
      if (args.path === "/api/cli/telemetry/sync") return { ok: true };
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
      if (args.path === "/api/cli/telemetry/sync") return { ok: true };
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

  it("allows empty changelog for updates (interactive)", async () => {
    interactive = true;
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path === "/api/cli/telemetry/sync") return { ok: true };
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

  it("skips telemetry when CLAWHUB_DISABLE_TELEMETRY is set", async () => {
    interactive = false;
    process.env.CLAWHUB_DISABLE_TELEMETRY = "1";
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path.startsWith("/api/v1/resolve?")) {
        return { match: { version: "1.0.0" }, latestVersion: { version: "1.0.0" } };
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`);
    });

    await cmdSync(makeOpts(), { root: ["/scan"], all: true, dryRun: true }, true);
    expect(
      mockApiRequest.mock.calls.some((call) => call[1]?.path === "/api/cli/telemetry/sync"),
    ).toBe(false);
    delete process.env.CLAWHUB_DISABLE_TELEMETRY;
  });
});
