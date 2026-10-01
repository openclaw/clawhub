/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthTokenModuleMocks,
  createHttpModuleMocks,
  createRegistryModuleMocks,
  createUiModuleMocks,
  makeGlobalOpts,
} from "../../../test/cliCommandTestKit.js";
import type { SkillOrigin } from "../../skills.js";

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
    { folder: `${root}/new-skill`, slug: "new-skill", displayName: "New Skill" },
    { folder: `${root}/synced-skill`, slug: "synced-skill", displayName: "Synced Skill" },
    { folder: `${root}/update-skill`, slug: "update-skill", displayName: "Update Skill" },
  ];
};

vi.mock("@clack/prompts", () => ({
  intro: (value: string) => mockIntro(value),
  outro: (value: string) => mockOutro(value),
  multiselect: (args: unknown) => mockMultiselect(args),
  isCancel: () => false,
}));

const authTokenMocks = createAuthTokenModuleMocks();
const registryMocks = createRegistryModuleMocks();
const httpMocks = createHttpModuleMocks();
const uiMocks = createUiModuleMocks();
const mockApiRequest = httpMocks.apiRequest;
const mockFail = uiMocks.fail;
const mockSpinner = uiMocks.spinner;
vi.mock("../authToken.js", () => authTokenMocks.moduleFactory());
vi.mock("../registry.js", () => registryMocks.moduleFactory());
vi.mock("../../http.js", () => httpMocks.moduleFactory());
vi.mock("../ui.js", () => ({
  createCrabLoader: vi.fn(() => mockSpinner),
  fail: (message: string) => mockFail(message),
  formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  isInteractive: () => interactive,
}));

vi.mock("../scanSkills.js", () => ({
  findSkillFolders: vi.fn(defaultFindSkillFolders),
  getFallbackSkillRoots: vi.fn(() => []),
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
const mockReadSkillOrigin = vi.fn(async (_folder?: string): Promise<SkillOrigin | null> => null);
vi.mock("../../skills.js", () => ({
  listSkillFiles: (folder: string) => mockListTextFiles(folder),
  hashSkillFiles: (files: Array<{ relPath: string; bytes: Uint8Array }>) =>
    mockHashSkillFiles(files),
  readSkillOrigin: (folder: string) => mockReadSkillOrigin(folder),
}));

const mockCmdPublish = vi.fn();
const mockPrepareSkillFilesForPublish = vi.fn(async (folder: string) => mockListTextFiles(folder));
vi.mock("./publish.js", () => ({
  cmdPublish: (opts: unknown, folder: unknown, options?: unknown) =>
    mockCmdPublish(opts, folder, options),
  prepareSkillFilesForPublish: (folder: string) => mockPrepareSkillFilesForPublish(folder),
  resolveDefaultOwnerHandle: async (_registry: string, _token: string) => "steipete",
}));

const { cmdSync } = await import("./sync");

function makeOpts() {
  return makeGlobalOpts();
}

afterEach(async () => {
  vi.clearAllMocks();
  mockCmdPublish.mockReset();
  mockPrepareSkillFilesForPublish.mockImplementation(async (folder: string) =>
    mockListTextFiles(folder),
  );
  mockReadSkillOrigin.mockImplementation(async (_folder?: string) => null);
  process.exitCode = undefined;
  const { findSkillFolders, getFallbackSkillRoots } = await import("../scanSkills.js");
  mocked(findSkillFolders).mockImplementation(defaultFindSkillFolders);
  mocked(getFallbackSkillRoots).mockImplementation(() => []);
});

vi.spyOn(console, "log").mockImplementation((...args) => {
  mockLog(args.map(String).join(" "));
});

describe("cmdSync", () => {
  it("emits CI JSON dry-run without requiring auth", async () => {
    interactive = false;
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockApiRequest.mockImplementation(async (_registry: string, args: { path?: string }) => {
      if (args.path?.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "new-skill") throw new Error("Skill not found");
        if (slug === "synced-skill") {
          return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
        }
        if (slug === "update-skill") {
          return { match: null, latestVersion: { version: "1.0.0" } };
        }
      }
      throw new Error(`Unexpected apiRequest: ${String(args.path)}`);
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
        },
        false,
      );
      output = String(stdoutWrite.mock.calls.at(-1)?.[0] ?? "").trim();
    } finally {
      stdoutWrite.mockRestore();
    }

    expect(authTokenMocks.requireAuthToken).not.toHaveBeenCalled();
    expect(mockCmdPublish).not.toHaveBeenCalled();
    expect(mockPrepareSkillFilesForPublish).toHaveBeenCalledTimes(3);
    for (const call of mockApiRequest.mock.calls) {
      const path = String(call[1]?.path ?? "");
      if (path.startsWith("/api/v1/resolve?")) {
        expect(new URL(`https://x.test${path}`).searchParams.get("ownerHandle")).toBe("nvidia");
      }
    }
    expect(mockLog).not.toHaveBeenCalled();
    expect(mockIntro).not.toHaveBeenCalled();
    expect(mockOutro).not.toHaveBeenCalled();

    const parsed = JSON.parse(output) as {
      ok: boolean;
      dryRun: boolean;
      owner?: string;
      summary: { wouldPublish: number; alreadySynced: number; failed: number };
      wouldPublish: Array<{ slug: string; version: string; status: string }>;
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
    expect(parsed.alreadySynced).toEqual([
      expect.objectContaining({ slug: "synced-skill", version: "1.2.3" }),
    ]);
    expect(parsed.published).toEqual([]);
    expect(parsed.failed).toEqual([]);
  });

  it("publishes selected skills without reporting install telemetry", async () => {
    interactive = false;
    mockApiRequest.mockImplementation(async (_registry: string, args: { path?: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path?.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "new-skill") throw new Error("Skill not found");
        if (slug === "synced-skill") {
          return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
        }
        if (slug === "update-skill") {
          return { match: null, latestVersion: { version: "1.0.0" } };
        }
      }
      throw new Error(`Unexpected apiRequest: ${String(args.path)}`);
    });

    await cmdSync(makeOpts(), { root: ["/scan"], all: true, dryRun: false }, true);

    expect(mockCmdPublish).toHaveBeenCalledTimes(2);
    expect(mockCmdPublish.mock.calls.map((call) => (call[2] as { slug: string }).slug)).toEqual([
      "new-skill",
      "update-skill",
    ]);
    for (const call of mockApiRequest.mock.calls) {
      const path = String(call[1]?.path ?? "");
      if (path.startsWith("/api/v1/resolve?")) {
        expect(new URL(`https://x.test${path}`).searchParams.get("ownerHandle")).toBe("steipete");
      }
    }
    expect(mockCmdPublish.mock.calls.map((call) => (call[2] as { owner: string }).owner)).toEqual([
      "steipete",
      "steipete",
    ]);
    expect(
      mockApiRequest.mock.calls.some((call) => call[1]?.path === "/api/cli/telemetry/install"),
    ).toBe(false);
  });

  it("owner-qualifies fork provenance from installed origins", async () => {
    interactive = false;
    mockReadSkillOrigin.mockImplementation(async (folder?: string) =>
      folder?.endsWith("/new-skill")
        ? {
            version: 1,
            registry: "https://clawhub.ai",
            slug: "new-skill",
            ownerHandle: "openclaw",
            installedVersion: "1.2.3",
            installedAt: 1,
          }
        : null,
    );
    mockApiRequest.mockImplementation(async (_registry: string, args: { path?: string }) => {
      if (args.path === "/api/v1/whoami") return { user: { handle: "steipete" } };
      if (args.path?.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "new-skill") throw new Error("Skill not found");
        return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
      }
      throw new Error(`Unexpected apiRequest: ${String(args.path)}`);
    });

    await cmdSync(makeOpts(), { root: ["/scan"], all: true, dryRun: false }, false);

    expect(mockCmdPublish).toHaveBeenCalledTimes(1);
    expect(mockCmdPublish.mock.calls[0]?.[2]).toMatchObject({
      slug: "new-skill",
      forkOf: "@openclaw/new-skill@1.2.3",
    });
  });

  it("resolves relative roots against --workdir and keeps source paths relative", async () => {
    interactive = false;
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/workspace/scan");
    const { findSkillFolders } = await import("../scanSkills.js");
    mockApiRequest.mockImplementation(async (_registry: string, args: { path?: string }) => {
      if (args.path?.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "synced-skill") {
          return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
        }
        throw new Error("Skill not found");
      }
      throw new Error(`Unexpected apiRequest: ${String(args.path)}`);
    });

    try {
      await cmdSync(
        makeGlobalOpts("/workspace"),
        {
          root: ["scan"],
          all: true,
          dryRun: false,
          sourceRepo: "example/tools",
          sourceCommit: "1234567890abcdef",
        },
        false,
      );
    } finally {
      cwdSpy.mockRestore();
    }

    expect(findSkillFolders).toHaveBeenCalledWith("/workspace/scan");
    expect(
      mockCmdPublish.mock.calls.map((call) => (call[2] as { sourcePath?: string }).sourcePath),
    ).toEqual(["scan/new-skill", "scan/update-skill"]);
  });

  it("uses scan-root-relative source paths for skills outside --workdir", async () => {
    interactive = false;
    mockApiRequest.mockImplementation(async (_registry: string, args: { path?: string }) => {
      if (args.path?.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "synced-skill") {
          return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
        }
        throw new Error("Skill not found");
      }
      throw new Error(`Unexpected apiRequest: ${String(args.path)}`);
    });

    await cmdSync(
      makeGlobalOpts("/workspace"),
      {
        root: ["/external/scan"],
        all: true,
        dryRun: false,
        sourceRepo: "example/tools",
        sourceCommit: "1234567890abcdef",
      },
      false,
    );

    expect(
      mockCmdPublish.mock.calls.map((call) => (call[2] as { sourcePath?: string }).sourcePath),
    ).toEqual(["new-skill", "update-skill"]);
  });

  it("keeps real sync JSON output owned by sync", async () => {
    interactive = false;
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockApiRequest.mockImplementation(async (_registry: string, args: { path?: string }) => {
      if (args.path?.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "new-skill") throw new Error("Skill not found");
        if (slug === "synced-skill") {
          return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
        }
        if (slug === "update-skill") {
          return { match: null, latestVersion: { version: "1.0.0" } };
        }
      }
      throw new Error(`Unexpected apiRequest: ${String(args.path)}`);
    });
    mockCmdPublish.mockImplementation((_opts: unknown, _folder: unknown, options?: unknown) => {
      if (!(options as { quiet?: boolean } | undefined)?.quiet) {
        process.stdout.write("child publish output\n");
      }
      return {
        status: "published",
        version: (options as { version?: string } | undefined)?.version ?? "1.0.0",
        publicationStatus: "published",
      };
    });

    let output = "";
    try {
      await cmdSync(makeOpts(), { root: ["/scan"], all: true, dryRun: false, json: true }, false);
      expect(stdoutWrite).toHaveBeenCalledTimes(1);
      output = String(stdoutWrite.mock.calls[0]?.[0] ?? "");
    } finally {
      stdoutWrite.mockRestore();
    }

    const parsed = JSON.parse(output);
    expect(parsed).toMatchObject({
      ok: true,
      summary: { published: 2, failed: 0 },
    });
    expect(mockCmdPublish.mock.calls.map((call) => (call[2] as { quiet?: boolean }).quiet)).toEqual(
      [true, true],
    );
  });

  it("keeps pending sync submissions out of the published json summary", async () => {
    interactive = false;
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockApiRequest.mockImplementation(async (_registry: string, args: { path?: string }) => {
      if (args.path?.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "new-skill") throw new Error("Skill not found");
        if (slug === "synced-skill") {
          return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
        }
        if (slug === "update-skill") {
          return { match: null, latestVersion: { version: "1.0.0" } };
        }
      }
      throw new Error(`Unexpected apiRequest: ${String(args.path)}`);
    });
    mockCmdPublish.mockImplementation(
      (_opts: unknown, _folder: unknown, options?: { slug?: string; version?: string }) =>
        options?.slug === "new-skill"
          ? {
              status: "pending-publication",
              version: options.version,
              publicationStatus: "pending",
            }
          : {
              status: "published",
              version: options?.version,
              publicationStatus: "published",
            },
    );

    let output = "";
    try {
      await cmdSync(makeOpts(), { root: ["/scan"], all: true, json: true }, false);
      output = String(stdoutWrite.mock.calls[0]?.[0] ?? "");
    } finally {
      stdoutWrite.mockRestore();
    }

    const parsed = JSON.parse(output);
    expect(parsed.summary).toMatchObject({ published: 1, submitted: 1, failed: 0 });
    expect(parsed.published).toEqual([
      expect.objectContaining({ slug: "update-skill", version: "1.0.1" }),
    ]);
    expect(parsed.submitted).toEqual([
      expect.objectContaining({
        slug: "new-skill",
        version: "1.0.0",
        status: "pending-publication",
        publicationStatus: "pending",
      }),
    ]);
  });

  it("does not call pending sync submissions published in human summaries", async () => {
    interactive = false;
    mockApiRequest.mockImplementation(async (_registry: string, args: { path?: string }) => {
      if (args.path?.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "new-skill") throw new Error("Skill not found");
        if (slug === "synced-skill") {
          return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
        }
        if (slug === "update-skill") {
          return { match: null, latestVersion: { version: "1.0.0" } };
        }
      }
      throw new Error(`Unexpected apiRequest: ${String(args.path)}`);
    });
    mockCmdPublish.mockImplementation(
      (_opts: unknown, _folder: unknown, options?: { slug?: string; version?: string }) =>
        options?.slug === "new-skill"
          ? {
              status: "pending-publication",
              version: options.version,
              publicationStatus: "pending",
            }
          : {
              status: "published",
              version: options?.version,
              publicationStatus: "published",
            },
    );

    await cmdSync(makeOpts(), { root: ["/scan"], all: true }, false);

    expect(mockOutro).toHaveBeenCalledWith("Published 1 skill(s). Submitted 1 update(s).");
  });

  it("does not report a raced unchanged publish as uploaded", async () => {
    interactive = false;
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockApiRequest.mockImplementation(async (_registry: string, args: { path?: string }) => {
      if (args.path?.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "new-skill") throw new Error("Skill not found");
        if (slug === "synced-skill") {
          return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
        }
        if (slug === "update-skill") {
          return { match: null, latestVersion: { version: "1.0.0" } };
        }
      }
      throw new Error(`Unexpected apiRequest: ${String(args.path)}`);
    });
    mockCmdPublish.mockImplementation(
      (_opts: unknown, _folder: unknown, options?: { slug?: string; version?: string }) =>
        options?.slug === "new-skill"
          ? { status: "unchanged", version: options.version }
          : { status: "published", version: options?.version },
    );

    let output = "";
    try {
      await cmdSync(makeOpts(), { root: ["/scan"], all: true, json: true }, false);
      output = String(stdoutWrite.mock.calls[0]?.[0] ?? "");
    } finally {
      stdoutWrite.mockRestore();
    }

    const parsed = JSON.parse(output);
    expect(parsed.summary).toMatchObject({ published: 1, alreadySynced: 2, failed: 0 });
    expect(parsed.published).toEqual([
      expect.objectContaining({ slug: "update-skill", version: "1.0.1" }),
    ]);
    expect(parsed.alreadySynced).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "synced-skill", version: "1.2.3" }),
        expect.objectContaining({ slug: "new-skill", version: "1.0.0" }),
      ]),
    );
  });

  it("requires --all for non-interactive publish mode", async () => {
    interactive = false;
    mockApiRequest.mockImplementation(async (_registry: string, args: { path?: string }) => {
      if (args.path?.startsWith("/api/v1/resolve?")) {
        const u = new URL(`https://x.test${args.path}`);
        const slug = u.searchParams.get("slug");
        if (slug === "synced-skill") {
          return { match: { version: "1.2.3" }, latestVersion: { version: "1.2.3" } };
        }
        throw new Error("Skill not found");
      }
      throw new Error(`Unexpected apiRequest: ${String(args.path)}`);
    });

    await expect(cmdSync(makeOpts(), { root: ["/scan"], dryRun: false }, false)).rejects.toThrow(
      "Pass --all",
    );

    expect(mockMultiselect).not.toHaveBeenCalled();
    expect(mockCmdPublish).not.toHaveBeenCalled();
  });

  it("refuses real --all publishes from fallback roots", async () => {
    interactive = false;
    const { findSkillFolders, getFallbackSkillRoots } = await import("../scanSkills.js");
    mocked(findSkillFolders).mockImplementation(async (root: string) => {
      if (root === "/work" || root === "/work/skills") return [];
      if (root === "/fallback/skills") {
        return [
          {
            folder: "/fallback/skills/private-skill",
            slug: "private-skill",
            displayName: "Private Skill",
          },
        ];
      }
      return [];
    });
    mocked(getFallbackSkillRoots).mockImplementation(() => ["/fallback/skills"]);
    mockApiRequest.mockImplementation(async (_registry: string, args: { path?: string }) => {
      if (args.path?.startsWith("/api/v1/resolve?")) throw new Error("Skill not found");
      throw new Error(`Unexpected apiRequest: ${String(args.path)}`);
    });

    await expect(cmdSync(makeOpts(), { all: true, dryRun: false }, false)).rejects.toThrow(
      "Refusing to publish fallback skill roots with --all",
    );

    expect(mockCmdPublish).not.toHaveBeenCalled();
    expect(mockPrepareSkillFilesForPublish).not.toHaveBeenCalled();
    expect(mockApiRequest).not.toHaveBeenCalled();
  });
});
