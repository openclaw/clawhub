/* @vitest-environment node */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const uiMocks = createUiModuleMocks();
let publishResponse: Record<string, unknown>;

vi.mock("../authToken.js", () => authTokenMocks.moduleFactory());
vi.mock("../registry.js", () => registryMocks.moduleFactory());
vi.mock("../../http.js", async () => {
  const actual = await vi.importActual<typeof import("../../http.js")>("../../http.js");
  return { ...httpMocks.moduleFactory(), getHttpErrorDiagnostic: actual.getHttpErrorDiagnostic };
});
vi.mock("../ui.js", () => uiMocks.moduleFactory());

const { cmdPublish } = await import("./publish");
const realHttp = await vi.importActual<typeof import("../../http.js")>("../../http.js");

async function makeTmpWorkdir() {
  const root = await mkdtemp(join(tmpdir(), "clawhub-publish-"));
  return root;
}

function makeOpts(workdir: string) {
  return makeGlobalOpts(workdir);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockDefaultApiRequest();
});

describe("cmdPublish", () => {
  it.each([
    { status: 400, body: "Version already exists", expected: "Version already exists" },
    {
      status: 400,
      body: "Unknown publisher @missing-owner",
      expected: "Unknown publisher @missing-owner",
    },
    {
      status: 401,
      body: "Unauthorized",
      expected: "Authentication failed. Run `clawhub login` again.",
    },
  ])("preserves actionable API guidance on HTTP $status: $body", async (fixture) => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "validation-error");
      await mkdir(folder);
      await writeFile(join(folder, "SKILL.md"), "# Skill\n");
      const client = realHttp.createHttpClient({
        runtime: "node",
        configureDispatcher: false,
        env: {},
        fetchImpl: vi.fn(
          async () => new Response(fixture.body, { status: fixture.status }),
        ) as typeof fetch,
      });
      const failure = await client
        .apiRequest("https://fixture.invalid", {
          method: "POST",
          path: "/api/v1/skills",
          retryCount: 0,
        })
        .catch((error: unknown) => error);
      const defaultRequest = httpMocks.apiRequest.getMockImplementation();
      httpMocks.apiRequest.mockImplementation(async (registry, request, schema) => {
        if ((request as { path?: string }).path === "/api/v1/skills") throw failure;
        return await defaultRequest?.(registry, request, schema);
      });
      const caught = await cmdPublish(makeOpts(workdir), "validation-error", {}).catch(
        (error: unknown) => error,
      );
      expect(caught).toBe(failure);
      expect((caught as Error).message).toContain("Publish (files 1/1)");
      expect((caught as Error).message).toContain(`HTTP ${fixture.status}`);
      expect((caught as Error).message).toContain(fixture.expected);
      expect(realHttp.getHttpErrorStatus(caught)).toBe(fixture.status);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  for (const mode of [{}, { quiet: true }, { json: true }]) {
    it.each([
      { phase: "ticket", status: 400, label: "Upload ticket (file 2/2)", uploads: 1 },
      { phase: "body", status: 503, label: "File body (file 2/2)", uploads: 2 },
      { phase: "publish", status: 500, label: "Publish (files 2/2)", uploads: 2 },
    ])(`reports $phase failure safely with ${JSON.stringify(mode)}`, async (fixture) => {
      const workdir = await makeTmpWorkdir();
      try {
        const folder = join(workdir, "diagnostics");
        await mkdir(folder);
        await writeFile(join(folder, "SKILL.md"), "# Skill\n");
        await writeFile(join(folder, "extra.txt"), "file bytes");
        const client = realHttp.createHttpClient({
          runtime: "node",
          configureDispatcher: false,
          env: {},
          random: () => 0,
          fetchImpl: vi.fn(
            async () =>
              new Response("[Request ID: 0123456789abcdef] Request rejected", {
                status: fixture.status,
                headers: { "Retry-After": "53" },
              }),
          ) as typeof fetch,
          setTimeoutImpl: ((callback: () => void, ms: number) => {
            if (ms !== 15_000) callback();
            return 1;
          }) as unknown as typeof setTimeout,
          clearTimeoutImpl: vi.fn(),
        });
        const failure = await client
          .apiRequest("https://fixture.invalid", { method: "POST", path: "/x", retryCount: 0 })
          .catch((error: unknown) => error);
        const defaultRequest = httpMocks.apiRequest.getMockImplementation();
        let tickets = 0;
        httpMocks.apiRequest.mockImplementation(async (registry, request, schema) => {
          const args = request as { path?: string };
          if (args.path === "/api/v1/skills/-/upload-url") {
            tickets += 1;
            if (fixture.phase === "ticket" && tickets === 2) throw failure;
          }
          if (fixture.phase === "publish" && args.path === "/api/v1/skills") throw failure;
          return await defaultRequest?.(registry, request, schema);
        });
        if (fixture.phase === "body") {
          httpMocks.uploadBinary
            .mockResolvedValueOnce({ storageId: "storage:1" })
            .mockRejectedValueOnce(failure);
        }

        const caught = await cmdPublish(makeOpts(workdir), "diagnostics", mode).catch(
          (error: unknown) => error,
        );
        expect(caught).toBe(failure);
        expect(realHttp.getHttpErrorStatus(caught)).toBe(fixture.status);
        expect((caught as Error).message).toBe(
          `${fixture.label}: HTTP ${fixture.status} (Request ID: 0123456789abcdef): Request rejected (retry in 53s, reset in 53s)`,
        );
        expect(tickets).toBe(2);
        expect(httpMocks.uploadBinary).toHaveBeenCalledTimes(fixture.uploads);
        const publishes = httpMocks.apiRequest.mock.calls.filter(
          (call) => (call[1] as { path?: string }).path === "/api/v1/skills",
        );
        expect(publishes).toHaveLength(fixture.phase === "publish" ? 1 : 0);
        if (mode.quiet || mode.json) {
          expect(uiMocks.spinner.fail).not.toHaveBeenCalled();
        } else {
          expect(uiMocks.spinner.fail).toHaveBeenCalledWith((caught as Error).message);
        }
      } finally {
        await rm(workdir, { recursive: true, force: true });
      }
    });
  }

  it("omits transport messages and causes from file-body failures", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "transport-failure");
      await mkdir(folder);
      await writeFile(join(folder, "SKILL.md"), "# Skill\n");
      httpMocks.uploadBinary.mockRejectedValueOnce(
        new TypeError("fetch failed https://upload.invalid/private?token=secret", {
          cause: new Error("Authorization: Bearer secret"),
        }),
      );
      const caught = await cmdPublish(makeOpts(workdir), "transport-failure", {}).catch(
        (error: unknown) => error,
      );
      expect((caught as Error).message).toBe("File body (file 1/1): Request failed");
      expect((caught as Error).cause).toBeUndefined();
      expect(httpMocks.uploadBinary).toHaveBeenCalledTimes(1);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("skips publishing when the local skill already matches ClawHub", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "unchanged-skill");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Skill\n", "utf8");
      httpMocks.apiRequest.mockResolvedValueOnce({
        match: { version: "1.2.3" },
        latestVersion: { version: "1.2.3" },
      });

      const result = await cmdPublish(makeOpts(workdir), "unchanged-skill", {});

      expect(result).toMatchObject({
        status: "unchanged",
        slug: "unchanged-skill",
        version: "1.2.3",
      });
      expect(authTokenMocks.requireAuthToken).not.toHaveBeenCalled();
      expect(httpMocks.apiRequestForm).not.toHaveBeenCalled();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("still skips an unchanged skill when only a changelog is supplied", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "changelog-only");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Skill\n", "utf8");
      httpMocks.apiRequest.mockResolvedValueOnce({
        match: { version: "1.2.3" },
        latestVersion: { version: "1.2.3" },
      });

      const result = await cmdPublish(makeOpts(workdir), "changelog-only", {
        changelog: "Describe the changes in this release.",
      });

      // changelog is not part of hasExplicitCatalogMetadata, so unlike categories and
      // topics it does not turn a catalog-wide run into a release of every skill.
      expect(result).toMatchObject({ status: "unchanged", version: "1.2.3" });
      expect(httpMocks.apiRequestForm).not.toHaveBeenCalled();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("publishes explicit catalog metadata when the local skill content is unchanged", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "metadata-update");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Skill\n", "utf8");
      httpMocks.apiRequest.mockResolvedValueOnce({
        match: { version: "1.2.3" },
        latestVersion: { version: "1.2.3" },
      });
      mockPublishResponse({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_2",
        publicationStatus: "published",
      });

      const result = await cmdPublish(makeOpts(workdir), "metadata-update", {
        categories: "research",
        topics: "AI",
      });

      expect(result).toMatchObject({
        status: "published",
        slug: "metadata-update",
        version: "1.2.4",
      });
      expect(publishPayload()).toMatchObject({
        version: "1.2.4",
        categories: ["research"],
        topics: ["AI"],
      });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("defaults a new skill to version 1.0.0", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "new-skill");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Skill\n", "utf8");
      httpMocks.apiRequest.mockRejectedValueOnce(
        new Error("Skill not found or unavailable to this account."),
      );
      mockPublishResponse({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_1",
        publicationStatus: "published",
      });

      const result = await cmdPublish(makeOpts(workdir), "new-skill", {});

      expect(result).toMatchObject({
        status: "published",
        slug: "new-skill",
        version: "1.0.0",
      });
      expect(publishPayload()).toMatchObject({ version: "1.0.0" });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("reports pending security checks for staged publish responses", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "pending-skill");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Skill\n", "utf8");
      httpMocks.apiRequest.mockRejectedValueOnce(
        new Error("Skill not found or unavailable to this account."),
      );
      mockPublishResponse({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_pending",
        publicationStatus: "pending",
        attemptId: "attempt_1",
      });

      const result = await cmdPublish(makeOpts(workdir), "pending-skill", {});

      expect(result).toMatchObject({
        status: "pending-publication",
        slug: "pending-skill",
        version: "1.0.0",
        versionId: "ver_pending",
        publicationStatus: "pending",
        attemptId: "attempt_1",
      });
      expect(uiMocks.spinner.succeed).toHaveBeenCalledWith(
        "Update submitted for pending-skill@1.0.0; pending security scans before it becomes public.",
      );
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("makes pending publication unambiguous in json output", async () => {
    const workdir = await makeTmpWorkdir();
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const folder = join(workdir, "json-pending-skill");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Skill\n", "utf8");
      httpMocks.apiRequest.mockRejectedValueOnce(
        new Error("Skill not found or unavailable to this account."),
      );
      mockPublishResponse({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_pending",
        publicationStatus: "pending",
        attemptId: "attempt_1",
      });

      await cmdPublish(makeOpts(workdir), "json-pending-skill", { json: true });

      expect(uiMocks.spinner.succeed).not.toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalledTimes(1);
      const output = JSON.parse(String(writeSpy.mock.calls[0]?.[0] ?? ""));
      expect(output).toMatchObject({
        status: "pending-publication",
        slug: "json-pending-skill",
        version: "1.0.0",
        publicationStatus: "pending",
        attemptId: "attempt_1",
      });
      expect(output.status).not.toBe("published");
    } finally {
      writeSpy.mockRestore();
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("does not claim a skill was published when the server omits publication status", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "unknown-status-skill");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Skill\n", "utf8");
      mockPublishResponse({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_1",
      });

      const result = await cmdPublish(makeOpts(workdir), "unknown-status-skill", {});

      expect(result.status).toBe("submitted");
      expect(uiMocks.spinner.succeed).toHaveBeenCalledWith(
        "Update submitted for unknown-status-skill@1.0.0; publication status was not reported.",
      );
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("defaults a changed skill to the next patch version", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "changed-skill");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Changed skill\n", "utf8");
      httpMocks.apiRequest.mockResolvedValueOnce({
        match: null,
        latestVersion: { version: "1.2.3" },
      });
      mockPublishResponse({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_2",
        publicationStatus: "published",
      });

      const result = await cmdPublish(makeOpts(workdir), "changed-skill", {});

      expect(result).toMatchObject({
        status: "published",
        slug: "changed-skill",
        version: "1.2.4",
      });
      expect(publishPayload()).toMatchObject({ version: "1.2.4" });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("publishes an explicit version even when the content already matches", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "explicit-version");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Skill\n", "utf8");
      httpMocks.apiRequest.mockResolvedValueOnce({
        match: { version: "1.2.3" },
        latestVersion: { version: "1.2.3" },
      });
      mockPublishResponse({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_2",
        publicationStatus: "published",
      });

      const result = await cmdPublish(makeOpts(workdir), "explicit-version", {
        version: "2.0.0",
      });

      expect(result).toMatchObject({
        status: "published",
        slug: "explicit-version",
        version: "2.0.0",
      });
      expect(publishPayload()).toMatchObject({ version: "2.0.0" });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("previews the resolved publish without requiring auth", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "preview-skill");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Changed skill\n", "utf8");
      httpMocks.apiRequest.mockResolvedValueOnce({
        match: null,
        latestVersion: { version: "2.0.0" },
      });

      const result = await cmdPublish(makeOpts(workdir), "preview-skill", { dryRun: true });

      expect(result).toMatchObject({
        status: "would-publish",
        slug: "preview-skill",
        version: "2.0.1",
      });
      expect(authTokenMocks.requireAuthToken).not.toHaveBeenCalled();
      expect(httpMocks.apiRequestForm).not.toHaveBeenCalled();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("uploads each skill file separately before sending the publish metadata", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "staged-skill");
      await mkdir(join(folder, "assets"), { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Staged skill\n", "utf8");
      await writeFile(join(folder, "assets", "payload.bin"), Uint8Array.from([0, 1, 2, 255]));

      httpMocks.uploadBinary
        .mockResolvedValueOnce({ storageId: "storage:skill" })
        .mockResolvedValueOnce({ storageId: "storage:payload" });
      mockPublishResponse({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_1",
        publicationStatus: "published",
      });

      await cmdPublish(makeOpts(workdir), "staged-skill", {
        version: "1.0.0",
      });

      expect(httpMocks.apiRequestForm).not.toHaveBeenCalled();
      expect(httpMocks.uploadBinary).toHaveBeenCalledTimes(2);
      const uploadTicketCalls = httpMocks.apiRequest.mock.calls.filter((call) => {
        const args = call[1] as { method?: string; path?: string };
        return args.method === "POST" && args.path === "/api/v1/skills/-/upload-url";
      });
      expect(uploadTicketCalls).toHaveLength(2);
      expect(uploadTicketCalls[0]?.[1]).toMatchObject({
        token: "tkn",
        body: {
          path: "SKILL.md",
          size: 15,
          sha256: "90b735dd867ee1111738fb1397982e1dbf7e6bda451d60d60fc10623926adcfc",
        },
      });
      expect(httpMocks.uploadBinary).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          url: "https://upload.local/1",
          token: "tkn",
        }),
        expect.anything(),
      );
      const publishCall = httpMocks.apiRequest.mock.calls.find((call) => {
        const args = call[1] as { method?: string; path?: string };
        return args.method === "POST" && args.path === "/api/v1/skills";
      });
      expect(publishCall?.[1]).toMatchObject({
        method: "POST",
        path: "/api/v1/skills",
        token: "tkn",
        body: {
          slug: "staged-skill",
          files: [
            expect.objectContaining({
              path: "SKILL.md",
              size: 15,
              storageId: "storage:skill",
              sha256: "90b735dd867ee1111738fb1397982e1dbf7e6bda451d60d60fc10623926adcfc",
              uploadTicket: "skillPublishUploadTickets:1",
            }),
            expect.objectContaining({
              path: "assets/payload.bin",
              size: 4,
              storageId: "storage:payload",
              sha256: "3d1f57c984978ef98a18378c8166c1cb8ede02c03eeb6aee7e2f121dfeee3e56",
              contentType: "application/octet-stream",
              uploadTicket: "skillPublishUploadTickets:2",
            }),
          ],
        },
      });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("publishes Terraform and opaque files with exact bytes (mocked HTTP)", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "my-skill");
      const opaqueBytes = Uint8Array.from([0, 1, 2, 255]);
      await mkdir(folder, { recursive: true });
      await mkdir(join(folder, "assets"), { recursive: true });
      const skillContent = "# Skill\n\nHello\n";
      const notesContent = "notes\n";
      const terraformContent = 'resource "null_resource" "demo" {}\n';
      const variablesContent = 'region = "us-east-1"\n';
      await writeFile(join(folder, "SKILL.md"), skillContent, "utf8");
      await writeFile(join(folder, "notes.md"), notesContent, "utf8");
      await writeFile(join(folder, "main.tf"), terraformContent, "utf8");
      await writeFile(join(folder, "terraform.tfvars"), variablesContent, "utf8");
      await writeFile(join(folder, "assets", "payload.bin"), opaqueBytes);

      mockPublishResponse({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_1",
      });

      const options = {
        slug: "my-skill",
        name: "My Skill",
        version: "1.0.0",
        changelog: "",
        tags: "latest",
        categories: "automation, development",
        topics: "React, GPU development",
      } as Parameters<typeof cmdPublish>[2];

      await cmdPublish(makeOpts(workdir), "my-skill", options);

      const payload = publishPayload();
      expect(payload.slug).toBe("my-skill");
      expect(payload.displayName).toBe("My Skill");
      expect(payload.ownerHandle).toBe("me");
      expect(payload.version).toBe("1.0.0");
      expect(payload.changelog).toBe("");
      expect(payload.acceptLicenseTerms).toBe(true);
      expect(payload.tags).toEqual(["latest"]);
      expect(payload.categories).toEqual(["automation", "development"]);
      expect(payload.topics).toEqual(["React", "GPU development"]);
      const files = payload.files as Array<{ path: string }>;
      expect(files.map((file) => file.path).sort()).toEqual([
        "SKILL.md",
        "assets/payload.bin",
        "main.tf",
        "notes.md",
        "terraform.tfvars",
      ]);
      const uploadedBytes = new Map(
        files.map((file, index) => {
          const uploadCall = httpMocks.uploadBinary.mock.calls[index];
          if (!uploadCall) throw new Error(`Missing upload call for ${file.path}`);
          return [file.path, (uploadCall[0] as { bytes: Uint8Array }).bytes] as const;
        }),
      );
      expect(new TextDecoder().decode(uploadedBytes.get("main.tf"))).toBe(terraformContent);
      expect(new TextDecoder().decode(uploadedBytes.get("terraform.tfvars"))).toBe(
        variablesContent,
      );
      expect(uploadedBytes.get("assets/payload.bin")).toEqual(opaqueBytes);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("sends explicit empty catalog metadata to clear existing skill values", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "clear-topics");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Clear topics\n", "utf8");

      mockPublishResponse({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_1",
      });

      await cmdPublish(makeOpts(workdir), "clear-topics", { categories: "", topics: "" });

      expect(publishPayload()).toMatchObject({ categories: [], topics: [] });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("sends owner-scoped fork provenance when --fork-of is owner-qualified", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "demo-fork");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Skill\n", "utf8");

      mockPublishResponse({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_1",
      });

      await cmdPublish(makeOpts(workdir), "demo-fork", {
        slug: "demo-fork",
        name: "Demo Fork",
        version: "1.0.0",
        changelog: "",
        forkOf: "@openclaw/demo@1.2.3",
      });

      expect(publishPayload().forkOf).toEqual({
        slug: "demo",
        ownerHandle: "openclaw",
        version: "1.2.3",
      });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("strips generated Skill Cards before publishing downloaded bundles", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "downloaded-skill");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Skill\n", "utf8");
      await writeFile(join(folder, "notes.md"), "notes\n", "utf8");
      await writeFile(join(folder, "skill-card.md"), "# Generated card\n", "utf8");

      mockPublishResponse({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_1",
      });

      await cmdPublish(makeOpts(workdir), "downloaded-skill", {
        slug: "downloaded-skill",
        name: "Downloaded Skill",
        version: "1.0.0",
        changelog: "",
        tags: "latest",
      });

      const files = publishPayload().files as Array<{ path: string }>;
      expect(files.map((file) => file.path).sort()).toEqual(["SKILL.md", "notes.md"]);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("allows empty changelog when updating an existing skill", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "existing-skill");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Skill\n", "utf8");

      mockPublishResponse({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_2",
      });

      await cmdPublish(makeOpts(workdir), "existing-skill", {
        version: "1.0.1",
        changelog: "",
        tags: "latest",
      });

      expect(publishPayload()).toMatchObject({ changelog: "" });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("still publishes a root SKILL.md hidden by broad ignore patterns", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "ignored-manifest");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, ".gitignore"), "*.md\n", "utf8");
      await writeFile(join(folder, "SKILL.md"), "# Skill\n", "utf8");
      await writeFile(join(folder, "notes.md"), "ignored notes\n", "utf8");

      mockPublishResponse({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_1",
      });

      await cmdPublish(makeOpts(workdir), "ignored-manifest", {
        slug: "ignored-manifest",
        name: "Ignored Manifest",
        version: "1.0.0",
        changelog: "",
        tags: "latest",
      });

      const files = publishPayload().files as Array<{ path: string }>;
      expect(files.map((file) => file.path)).toEqual(["SKILL.md"]);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("includes owner handle for org-owned skill publishes", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "org-skill");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Skill\n", "utf8");

      mockPublishResponse({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_2",
      });

      await cmdPublish(makeOpts(workdir), "org-skill", {
        owner: "@openclaw",
        migrateOwner: true,
        version: "1.0.1",
        changelog: "",
        tags: "latest",
      });

      const payload = publishPayload();
      expect(payload.ownerHandle).toBe("openclaw");
      expect(payload.sourceOwnerHandle).toBe("me");
      expect(payload.migrateOwner).toBe(true);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("fails clearly when publishing without --owner and whoami has no handle", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "anonymous-skill");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Skill\n", "utf8");

      mockDefaultApiRequest(null);

      await expect(
        cmdPublish(makeOpts(workdir), "anonymous-skill", {
          version: "1.0.0",
          changelog: "",
          tags: "latest",
        }),
      ).rejects.toThrow("Unable to resolve your publisher handle. Pass --owner explicitly.");
      expect(httpMocks.apiRequestForm).not.toHaveBeenCalled();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("includes GitHub source provenance for CI publishes", async () => {
    const workdir = await makeTmpWorkdir();
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(123_456_789);
    try {
      const folder = join(workdir, "source-skill");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Skill\n", "utf8");

      mockDefaultApiRequest("steipete");
      mockPublishResponse({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_1",
      });

      await cmdPublish(makeOpts(workdir), "source-skill", {
        slug: "source-skill",
        name: "Source Skill",
        version: "1.0.0",
        sourceRepo: "https://github.com/NVIDIA/skills",
        sourceCommit: "abc123",
        sourceRef: "refs/heads/main",
        sourcePath: "skills/source-skill",
      });

      const payload = publishPayload();
      expect(payload.source).toEqual({
        kind: "github",
        url: "https://github.com/NVIDIA/skills",
        repo: "NVIDIA/skills",
        ref: "refs/heads/main",
        commit: "abc123",
        path: "skills/source-skill",
        importedAt: 123_456_789,
      });
    } finally {
      dateSpy.mockRestore();
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it('rejects plugin folders with guidance to use "clawhub package publish"', async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "demo-plugin");
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, "package.json"),
        JSON.stringify({ name: "demo-plugin", openclaw: { extensions: ["./index.ts"] } }),
        "utf8",
      );
      await writeFile(join(folder, "openclaw.plugin.json"), '{"id":"demo-plugin"}', "utf8");

      await expect(
        cmdPublish(makeOpts(workdir), "demo-plugin", {
          slug: "demo-plugin",
          name: "Demo Plugin",
          version: "1.0.0",
          tags: "latest",
        }),
      ).rejects.toThrow(
        'This looks like a plugin. Use "clawhub package publish <source>" instead.',
      );
      expect(authTokenMocks.requireAuthToken).not.toHaveBeenCalled();
      expect(httpMocks.apiRequestForm).not.toHaveBeenCalled();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });
});

function publishPayload() {
  const publishCall = httpMocks.apiRequest.mock.calls.find((call) => {
    const request = call[1] as { method?: string; path?: string } | undefined;
    return request?.method === "POST" && request.path === "/api/v1/skills";
  });
  if (!publishCall) throw new Error("Missing publish call");
  const body = (publishCall[1] as { body?: unknown }).body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Missing publish payload");
  }
  return body as Record<string, unknown>;
}

function mockPublishResponse(response: Record<string, unknown>) {
  publishResponse = response;
}

function mockDefaultApiRequest(whoamiHandle: string | null = "me") {
  publishResponse = {
    ok: true,
    skillId: "skill_1",
    versionId: "ver_1",
    publicationStatus: "published",
  };
  let uploadIndex = 0;
  httpMocks.apiRequest.mockReset();
  httpMocks.apiRequest.mockImplementation(async (_registry: unknown, request: unknown) => {
    if (isWhoamiRequest(request)) {
      return { user: { handle: whoamiHandle } };
    }
    const args = request as { method?: string; path?: string };
    if (args.method === "POST" && args.path === "/api/v1/skills/-/upload-url") {
      uploadIndex += 1;
      return {
        uploadUrl: `https://upload.local/${uploadIndex}`,
        uploadTicket: `skillPublishUploadTickets:${uploadIndex}`,
      };
    }
    if (args.method === "POST" && args.path === "/api/v1/skills") {
      return publishResponse;
    }
    return {
      match: null,
      latestVersion: null,
    };
  });
  let storageIndex = 0;
  httpMocks.uploadBinary.mockReset();
  httpMocks.uploadBinary.mockImplementation(async () => {
    storageIndex += 1;
    return { storageId: `storage:${storageIndex}` };
  });
}

function isWhoamiRequest(request: unknown) {
  const args = request as { path?: unknown; url?: unknown } | null | undefined;
  if (args?.path === "/api/v1/whoami") return true;
  if (typeof args?.url !== "string") return false;
  try {
    return new URL(args.url).pathname === "/api/v1/whoami";
  } catch {
    return false;
  }
}
