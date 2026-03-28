/* @vitest-environment node */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlobalOpts } from "../types";

const mockApiRequest = vi.fn();
const mockApiRequestForm = vi.fn();
const mockFetchText = vi.fn();
const mockRegistryUrl = vi.fn((path: string, registry: string) => {
  const base = registry.endsWith("/") ? registry : `${registry}/`;
  const relative = path.startsWith("/") ? path.slice(1) : path;
  return new URL(relative, base);
});
vi.mock("../../http.js", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  apiRequestForm: (...args: unknown[]) => mockApiRequestForm(...args),
  fetchText: (...args: unknown[]) => mockFetchText(...args),
  registryUrl: (...args: [string, string]) => mockRegistryUrl(...args),
}));

const mockGetRegistry = vi.fn(async (_opts?: unknown, _params?: unknown) => "https://clawhub.ai");
vi.mock("../registry.js", () => ({
  getRegistry: (opts: unknown, params?: unknown) => mockGetRegistry(opts, params),
}));

const mockGetOptionalAuthToken = vi.fn(async () => undefined as string | undefined);
const mockRequireAuthToken = vi.fn(async () => "tkn");
vi.mock("../authToken.js", () => ({
  getOptionalAuthToken: () => mockGetOptionalAuthToken(),
  requireAuthToken: () => mockRequireAuthToken(),
}));

const mockSpinner = {
  stop: vi.fn(),
  fail: vi.fn(),
  succeed: vi.fn(),
  start: vi.fn(),
  isSpinning: false,
  text: "",
};
vi.mock("../ui.js", () => ({
  createSpinner: vi.fn(() => mockSpinner),
  fail: (message: string) => {
    throw new Error(message);
  },
  formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

const { cmdExplorePackages, cmdInspectPackage, cmdPublishPackage } = await import("./packages");

const mockLog = vi.spyOn(console, "log").mockImplementation(() => {});
const mockWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

function makeOpts(workdir = "/work"): GlobalOpts {
  return {
    workdir,
    dir: join(workdir, "skills"),
    site: "https://clawhub.ai",
    registry: "https://clawhub.ai",
    registrySource: "default",
  };
}

async function makeTmpWorkdir() {
  return await mkdtemp(join(tmpdir(), "clawhub-package-"));
}

afterEach(() => {
  vi.clearAllMocks();
  mockLog.mockClear();
  mockWrite.mockClear();
});

describe("package commands", () => {
  it("searches package catalog via /api/v1/packages/search", async () => {
    mockApiRequest.mockResolvedValueOnce({
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
    });

    const request = mockApiRequest.mock.calls[0]?.[1] as { url?: string } | undefined;
    const url = new URL(String(request?.url));
    expect(url.pathname).toBe("/api/v1/packages/search");
    expect(url.searchParams.get("q")).toBe("demo plugin");
    expect(url.searchParams.get("family")).toBe("code-plugin");
    expect(url.searchParams.get("executesCode")).toBe("true");
  });

  it("supports skill family package browse requests", async () => {
    mockApiRequest.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    });

    await cmdExplorePackages(makeOpts(), "", { family: "skill", limit: 7 });

    const request = mockApiRequest.mock.calls[0]?.[1] as { url?: string } | undefined;
    const url = new URL(String(request?.url));
    expect(url.pathname).toBe("/api/v1/packages");
    expect(url.searchParams.get("family")).toBe("skill");
    expect(url.searchParams.get("limit")).toBe("7");
  });

  it("uses tag param when fetching a package file", async () => {
    mockApiRequest
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
    mockFetchText.mockResolvedValue("content");

    await cmdInspectPackage(makeOpts(), "demo", { file: "README.md", tag: "latest" });

    const fetchArgs = mockFetchText.mock.calls[0]?.[1] as { url?: string } | undefined;
    const url = new URL(String(fetchArgs?.url));
    expect(url.pathname).toBe("/api/v1/packages/demo/file");
    expect(url.searchParams.get("path")).toBe("README.md");
    expect(url.searchParams.get("tag")).toBe("latest");
    expect(url.searchParams.get("version")).toBeNull();
  });

  it("publishes a code plugin package with source metadata", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "demo-plugin");
      await mkdir(join(folder, "dist"), { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        JSON.stringify({
          name: "@scope/demo-plugin",
          displayName: "Demo Plugin",
          version: "1.0.0",
        }),
        "utf8",
      );
      await writeFile(join(folder, ".gitignore"), "dist/\n", "utf8");
      await writeFile(join(folder, "openclaw.plugin.json"), JSON.stringify({ id: "demo.plugin" }), "utf8");
      await writeFile(join(folder, "dist", "index.js"), "export const demo = true;\n", "utf8");

      mockApiRequestForm.mockResolvedValueOnce({
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

      const publishCall = mockApiRequestForm.mock.calls.find((call) => {
        const req = call[1] as { path?: string } | undefined;
        return req?.path === "/api/v1/packages";
      });
      if (!publishCall) throw new Error("Missing publish call");
      const publishForm = (publishCall[1] as { form?: FormData }).form as FormData;
      const payloadEntry = publishForm.get("payload");
      if (typeof payloadEntry !== "string") throw new Error("Missing publish payload");
      const payload = JSON.parse(payloadEntry);
      expect(payload.name).toBe("@scope/demo-plugin");
      expect(payload.ownerHandle).toBe("openclaw");
      expect(payload.family).toBe("code-plugin");
      expect(payload.version).toBe("1.0.0");
      expect(payload.source).toMatchObject({
        repo: "openclaw/demo-plugin",
        commit: "abc123",
        ref: "refs/tags/v1.0.0",
      });
      const files = publishForm.getAll("files") as Array<Blob & { name?: string }>;
      expect(files.map((file) => String(file.name ?? "")).sort()).toEqual([
        ".gitignore",
        "dist/index.js",
        "openclaw.plugin.json",
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
        JSON.stringify({ name: "demo-plugin", version: "1.0.0" }),
        "utf8",
      );
      await writeFile(join(folder, "openclaw.plugin.json"), JSON.stringify({ id: "demo.plugin" }), "utf8");

      await expect(cmdPublishPackage(makeOpts(workdir), "demo-plugin", {})).rejects.toThrow(
        "--source-repo and --source-commit required for code plugins",
      );
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });
});
