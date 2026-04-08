/* @vitest-environment node */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("cmdPublish", () => {
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

      await cmdPublish(makeOpts(workdir), "my-skill", {
        slug: "my-skill",
        name: "My Skill",
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
      const payloadEntry = publishForm.get("payload");
      if (typeof payloadEntry !== "string") throw new Error("Missing publish payload");
      const payload = JSON.parse(payloadEntry);
      expect(payload.slug).toBe("my-skill");
      expect(payload.displayName).toBe("My Skill");
      expect(payload.version).toBe("1.0.0");
      expect(payload.changelog).toBe("");
      expect(payload.acceptLicenseTerms).toBe(true);
      expect(payload.tags).toEqual(["latest"]);
      const files = publishForm.getAll("files") as Array<Blob & { name?: string }>;
      expect(files.map((file) => String(file.name ?? "")).sort()).toEqual(["SKILL.md", "notes.md"]);
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
