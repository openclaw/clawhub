import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthTokenModuleMocks,
  createHttpModuleMocks,
  createRegistryModuleMocks,
  createUiModuleMocks,
  makeGlobalOpts,
} from "../../../test/cliCommandTestKit.js";

const resources = vi.hoisted(() => ({
  created: [] as string[],
  removed: [] as string[],
  failRemoval: false,
}));
const httpMocks = createHttpModuleMocks();
const authMocks = createAuthTokenModuleMocks();
const registryMocks = createRegistryModuleMocks();
const uiMocks = createUiModuleMocks();

vi.mock("../../http.js", () => httpMocks.moduleFactory());
vi.mock("../authToken.js", () => authMocks.moduleFactory());
vi.mock("../registry.js", () => registryMocks.moduleFactory());
vi.mock("../ui.js", () => uiMocks.moduleFactory());
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdtemp: async (prefix: string) => {
      const path = await actual.mkdtemp(prefix);
      if (/clawhub-(github-publish|clawpack)-/.test(prefix)) resources.created.push(path);
      return path;
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (resources.created.includes(String(args[0]))) {
        resources.removed.push(String(args[0]));
        if (resources.failRemoval) throw new Error("Cleanup failed");
      }
      return await actual.rm(...args);
    },
  };
});

const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const { cmdPublishPackage } = await import("./packages.js");
const workdirs: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const path of [...resources.created, ...workdirs]) {
    await actualFs.rm(path, { recursive: true, force: true });
  }
  resources.created.length = 0;
  resources.removed.length = 0;
  resources.failRemoval = false;
  workdirs.length = 0;
  vi.clearAllMocks();
});

async function setupPublish() {
  const workdir = await mkdtemp(join(tmpdir(), "clawhub-cleanup-test-"));
  workdirs.push(workdir);
  await writeFile(join(workdir, "keep.txt"), "caller-owned");
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const archive = zipSync({
    "repo/package.json": new TextEncoder().encode(
      JSON.stringify({
        name: "cleanup-plugin",
        version: "1.0.0",
        openclaw: {
          extensions: ["./dist/index.js"],
          hostTargets: ["linux-x64"],
          environment: {},
          compat: { pluginApi: ">=2026.3.24-beta.2" },
          build: { openclawVersion: "2026.3.24-beta.2" },
        },
      }),
    ),
    "repo/openclaw.plugin.json": new TextEncoder().encode(
      JSON.stringify({ id: "cleanup.plugin", configSchema: { type: "object" } }),
    ),
    "repo/dist/index.js": new TextEncoder().encode("export {};\n"),
  });
  const { unzipSync } = await import("fflate");
  for (const [path, bytes] of Object.entries(unzipSync(archive))) {
    const localPath = join(workdir, path.slice("repo/".length));
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, bytes);
  }
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith("/repos/owner/repo/commits/main")) {
        return Response.json({ sha: commit });
      }
      if (url.endsWith(`/repos/owner/repo/zipball/${commit}`)) {
        return new Response(new Blob([Buffer.from(archive)]));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
  httpMocks.apiRequestForm.mockResolvedValue({
    ok: true,
    packageId: "pkg_1",
    releaseId: "rel_1",
    publicationStatus: "published",
  });
  return workdir;
}

describe("package publish resource ownership", () => {
  it.each(["published", "dry-run", "preparation failure", "late failure"] as const)(
    "cleans acquired directories after %s without deleting the caller directory",
    async (outcome) => {
      const workdir = await setupPublish();
      if (outcome === "late failure") {
        httpMocks.apiRequestForm.mockRejectedValueOnce(new Error("Publish rejected"));
      }
      const publish = cmdPublishPackage(makeGlobalOpts(workdir), "owner/repo@main", {
        ...(outcome === "dry-run" ? { dryRun: true } : {}),
        ...(outcome === "preparation failure" ? { version: "invalid" } : {}),
      });
      if (outcome === "preparation failure") {
        await expect(publish).rejects.toThrow("--version must be valid semver for code plugins");
      } else if (outcome === "late failure") {
        await expect(publish).rejects.toThrow("Publish rejected");
      } else {
        await publish;
      }
      expect(resources.created).toHaveLength(outcome === "preparation failure" ? 1 : 2);
      for (const path of resources.created) await expect(access(path)).rejects.toThrow();
      expect(resources.removed).toEqual(resources.created.toReversed());
      await expect(access(join(workdir, "keep.txt"))).resolves.toBeUndefined();
    },
  );

  it("preserves cleanup failure precedence and stops before earlier resources", async () => {
    const workdir = await setupPublish();
    resources.failRemoval = true;
    httpMocks.apiRequestForm.mockRejectedValueOnce(new Error("Publish rejected"));
    await expect(cmdPublishPackage(makeGlobalOpts(workdir), "owner/repo@main")).rejects.toThrow(
      "Cleanup failed",
    );
    expect(resources.created).toHaveLength(2);
    expect(resources.removed).toEqual([resources.created[1]]);
  });

  it("keeps a caller-owned local source after a dry run", async () => {
    const workdir = await setupPublish();
    await cmdPublishPackage(makeGlobalOpts(workdir), workdir, {
      dryRun: true,
      sourceRepo: "owner/repo",
      sourceCommit: "abc123",
    });
    expect(resources.created).toHaveLength(1);
    expect(resources.removed).toEqual(resources.created);
    await expect(access(join(workdir, "package.json"))).resolves.toBeUndefined();
    await expect(access(join(workdir, "keep.txt"))).resolves.toBeUndefined();
  });
});
