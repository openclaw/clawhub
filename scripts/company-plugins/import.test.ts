import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyBatch, prepareBatch } from "./import";
let configRoot: string;
beforeEach(async () => {
  configRoot = await mkdtemp(join(tmpdir(), "company-import-test-"));
  vi.stubEnv("CLAWHUB_CONFIG_PATH", join(configRoot, "config.json"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(configRoot, { recursive: true, force: true });
});
it("requires the exact reviewed plan before any publication", async () => {
  const batch = await prepareBatch({
    manifest: { version: 1, registries: [], sources: [], openclaw: [] },
    snapshots: [],
    catalog: [],
  });
  await expect(
    applyBatch(
      batch,
      {
        workdir: "/tmp",
        dir: "plugins",
        registry: "http://127.0.0.1:1",
        registrySource: "cli",
        site: "http://127.0.0.1:1",
      },
      "outdated-review",
    ),
  ).rejects.toThrow("differs from the reviewed");
});

async function importFixture(extraFiles: Record<string, string> = {}) {
  return prepareBatch({
    manifest: {
      version: 1,
      registries: [],
      sources: [
        {
          integration: "company",
          job: "notes",
          repo: "company/plugins",
          path: "",
          ref: "main",
          publisher: "company",
          authorship: "company",
          format: "claude",
          repositoryId: 1,
          ownerId: 2,
          ownershipEvidence: "https://company.example/plugins",
          categories: ["tools"],
        },
      ],
      openclaw: [],
    },
    catalog: [],
    snapshots: [
      {
        repo: "company/plugins",
        repositoryId: 1,
        ownerId: 2,
        commit: "a".repeat(40),
        updatedAt: "2026-09-01T00:00:00Z",
        files: {
          LICENSE: readFileSync("LICENSE", "utf8"),
          ".claude-plugin/plugin.json": JSON.stringify({ name: "notes" }),
          "skills/notes/SKILL.md": "# Read notes",
          ...extraFiles,
        },
      },
    ],
  });
}
it("rejects changed artifact bytes even when the earlier review digest is retained", async () => {
  const batch = await importFixture();
  batch.prepared[0].files["skills/notes/SKILL.md"] = Buffer.from("changed after review");
  await expect(
    applyBatch(
      batch,
      {
        workdir: "/tmp",
        dir: "plugins",
        registry: "http://127.0.0.1:1",
        registrySource: "cli",
        site: "http://127.0.0.1:1",
      },
      batch.digest,
    ),
  ).rejects.toThrow("differs from the reviewed");
});
it.each(["../escaped", "/absolute", "a/../../escaped"])(
  "rejects unsafe staged artifact path %s",
  async (path) => {
    await expect(importFixture({ [path]: "must not escape" })).rejects.toThrow(
      "Unsafe artifact path",
    );
  },
);

it("rejects a staged file set changed by publisher ignore rules", async () => {
  const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  const batch = await importFixture({ ".clawhubignore": "skills/**" });
  await expect(
    applyBatch(
      batch,
      {
        workdir: "/tmp",
        dir: "plugins",
        registry: "http://127.0.0.1:1",
        registrySource: "cli",
        site: "http://127.0.0.1:1",
      },
      batch.digest,
    ),
  ).rejects.toThrow("process.exit");
  expect(stderr.mock.calls.flat().join("\n")).toContain("Staged package inventory differs");
});
