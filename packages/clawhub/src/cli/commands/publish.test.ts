/* @vitest-environment node */

import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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

vi.mock("../authToken.js", () => authTokenMocks.moduleFactory());
vi.mock("../registry.js", () => registryMocks.moduleFactory());
vi.mock("../../http.js", () => httpMocks.moduleFactory());
vi.mock("../ui.js", () => uiMocks.moduleFactory());

const { cmdPublish } = await import("./publish");

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
      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_2",
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
      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_1",
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

  it("rejects case-colliding skill package files before publishing", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "case-collision");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "SKILL.md"), "# Skill\n", "utf8");
      await writeFile(join(folder, "skill.md"), "# Duplicate\n", "utf8");
      const names = await readdir(folder);
      if (!names.includes("SKILL.md") || !names.includes("skill.md")) return;

      await expect(cmdPublish(makeOpts(workdir), "case-collision", {})).rejects.toThrow(
        /Remove case-colliding SKILL\.md files/i,
      );

      expect(httpMocks.apiRequestForm).not.toHaveBeenCalled();
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
      httpMocks.apiRequestForm.mockResolvedValueOnce({
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
        "OK. Uploaded pending-skill@1.0.0; security checks are pending before it becomes public (ver_pending)",
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
      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_2",
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
      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_2",
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

  it("publishes SKILL.md from disk (mocked HTTP)", async () => {
    const workdir = await makeTmpWorkdir();
    try {
      const folder = join(workdir, "my-skill");
      await mkdir(folder, { recursive: true });
      const skillContent = "# Skill\n\nHello\n";
      const notesContent = "notes\n";
      await writeFile(join(folder, "SKILL.md"), skillContent, "utf8");
      await writeFile(join(folder, "notes.md"), notesContent, "utf8");

      httpMocks.apiRequestForm.mockResolvedValueOnce({
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

      const publishCall = httpMocks.apiRequestForm.mock.calls.find((call) => {
        const req = call[1] as { path?: string } | undefined;
        return req?.path === "/api/v1/skills";
      });
      if (!publishCall) throw new Error("Missing publish call");
      const publishForm = (publishCall[1] as { form?: FormData }).form as FormData;
      const payloadEntry = publishForm.get("payload");
      if (typeof payloadEntry !== "string") throw new Error("Missing publish payload");
      const payload = JSON.parse(payloadEntry);
      expect(payload.slug).toBe("my-skill");
      expect(payload.displayName).toBe("My Skill");
      expect(payload.ownerHandle).toBe("me");
      expect(payload.version).toBe("1.0.0");
      expect(payload.changelog).toBe("");
      expect(payload.acceptLicenseTerms).toBe(true);
      expect(payload.tags).toEqual(["latest"]);
      expect(payload.categories).toEqual(["automation", "development"]);
      expect(payload.topics).toEqual(["React", "GPU development"]);
      const files = publishForm.getAll("files") as Array<Blob & { name?: string }>;
      expect(files.map((file) => file.name ?? "").sort()).toEqual(["SKILL.md", "notes.md"]);
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

      httpMocks.apiRequestForm.mockResolvedValueOnce({
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

      httpMocks.apiRequestForm.mockResolvedValueOnce({
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

      const publishCall = httpMocks.apiRequestForm.mock.calls.find((call) => {
        const req = call[1] as { path?: string } | undefined;
        return req?.path === "/api/v1/skills";
      });
      if (!publishCall) throw new Error("Missing publish call");
      const publishForm = (publishCall[1] as { form?: FormData }).form as FormData;
      const payloadEntry = publishForm.get("payload");
      if (typeof payloadEntry !== "string") throw new Error("Missing publish payload");
      expect(JSON.parse(payloadEntry).forkOf).toEqual({
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

      httpMocks.apiRequestForm.mockResolvedValueOnce({
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

      const publishCall = httpMocks.apiRequestForm.mock.calls.find((call) => {
        const req = call[1] as { path?: string } | undefined;
        return req?.path === "/api/v1/skills";
      });
      if (!publishCall) throw new Error("Missing publish call");
      const publishForm = (publishCall[1] as { form?: FormData }).form as FormData;
      const files = publishForm.getAll("files") as Array<Blob & { name?: string }>;
      expect(files.map((file) => file.name ?? "").sort()).toEqual(["SKILL.md", "notes.md"]);
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

      httpMocks.apiRequestForm.mockResolvedValueOnce({
        ok: true,
        skillId: "skill_1",
        versionId: "ver_2",
      });

      await cmdPublish(makeOpts(workdir), "existing-skill", {
        version: "1.0.1",
        changelog: "",
        tags: "latest",
      });

      expect(httpMocks.apiRequestForm).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ path: "/api/v1/skills", method: "POST" }),
        expect.anything(),
      );
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

      httpMocks.apiRequestForm.mockResolvedValueOnce({
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

      const publishCall = httpMocks.apiRequestForm.mock.calls.find((call) => {
        const req = call[1] as { path?: string } | undefined;
        return req?.path === "/api/v1/skills";
      });
      if (!publishCall) throw new Error("Missing publish call");
      const publishForm = (publishCall[1] as { form?: FormData }).form as FormData;
      const files = publishForm.getAll("files") as Array<Blob & { name?: string }>;
      expect(files.map((file) => file.name ?? "")).toEqual(["SKILL.md"]);
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

      httpMocks.apiRequestForm.mockResolvedValueOnce({
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

      const publishCall = httpMocks.apiRequestForm.mock.calls.find((call) => {
        const req = call[1] as { path?: string } | undefined;
        return req?.path === "/api/v1/skills";
      });
      if (!publishCall) throw new Error("Missing publish call");
      const publishForm = (publishCall[1] as { form?: FormData }).form as FormData;
      const payloadEntry = publishForm.get("payload");
      if (typeof payloadEntry !== "string") throw new Error("Missing publish payload");
      const payload = JSON.parse(payloadEntry);
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
      httpMocks.apiRequestForm.mockResolvedValueOnce({
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

      const publishCall = httpMocks.apiRequestForm.mock.calls.find((call) => {
        const req = call[1] as { path?: string } | undefined;
        return req?.path === "/api/v1/skills";
      });
      if (!publishCall) throw new Error("Missing publish call");
      const publishForm = (publishCall[1] as { form?: FormData }).form as FormData;
      const payloadEntry = publishForm.get("payload");
      if (typeof payloadEntry !== "string") throw new Error("Missing publish payload");
      const payload = JSON.parse(payloadEntry);
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
  const publishCall = httpMocks.apiRequestForm.mock.calls.find((call) => {
    const request = call[1] as { path?: string } | undefined;
    return request?.path === "/api/v1/skills";
  });
  if (!publishCall) throw new Error("Missing publish call");
  const form = (publishCall[1] as { form?: FormData }).form;
  const payload = form?.get("payload");
  if (typeof payload !== "string") throw new Error("Missing publish payload");
  return JSON.parse(payload) as Record<string, unknown>;
}

function mockDefaultApiRequest(whoamiHandle: string | null = "me") {
  httpMocks.apiRequest.mockReset();
  httpMocks.apiRequest.mockImplementation(async (_registry: unknown, request: unknown) => {
    if (isWhoamiRequest(request)) {
      return { user: { handle: whoamiHandle } };
    }
    return {
      match: null,
      latestVersion: null,
    };
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
