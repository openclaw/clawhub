/* @vitest-environment node */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadEnvLocal,
  runLocalClawScanDryRun,
  type LocalClawScanDryRunEnv,
} from "./local-clawscan-dry-run";

async function makeTmpWorkdir() {
  return await mkdtemp(join(tmpdir(), "clawhub-local-clawscan-"));
}

async function writePlugin(root: string) {
  const folder = join(root, "plugin");
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "package.json"),
    JSON.stringify({ name: "demo-plugin", version: "1.0.0", displayName: "Demo Plugin" }),
    "utf8",
  );
  await writeFile(join(folder, "openclaw.plugin.json"), JSON.stringify({ id: "demo.plugin" }));
  await writeFile(join(folder, "index.ts"), "export const demo = true;\n", "utf8");
  return folder;
}

function makeOpenAiFetch(result: Record<string, unknown>) {
  return vi.fn(async () => {
    return new Response(
      JSON.stringify({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(result) }],
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadEnvLocal", () => {
  it("loads OPENAI_API_KEY from .env.local without overriding an existing value", async () => {
    const root = await makeTmpWorkdir();
    try {
      await writeFile(join(root, ".env.local"), "OPENAI_API_KEY=from-file\n", "utf8");
      const env: LocalClawScanDryRunEnv = {};
      await loadEnvLocal(root, env);
      expect(env.OPENAI_API_KEY).toBe("from-file");

      env.OPENAI_API_KEY = "already-set";
      await loadEnvLocal(root, env);
      expect(env.OPENAI_API_KEY).toBe("already-set");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("runLocalClawScanDryRun", () => {
  it("fails before scanning when OPENAI_API_KEY is unavailable", async () => {
    const root = await makeTmpWorkdir();
    try {
      const plugin = await writePlugin(root);
      await expect(
        runLocalClawScanDryRun({
          cwd: root,
          path: plugin,
          kind: "plugin",
          env: {},
          fetchImpl: makeOpenAiFetch({}),
        }),
      ).rejects.toThrow("OPENAI_API_KEY");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires SKILL.md for skill dry runs", async () => {
    const root = await makeTmpWorkdir();
    try {
      const folder = join(root, "skill");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "README.md"), "# Demo\n", "utf8");
      await writeFile(join(root, ".env.local"), "OPENAI_API_KEY=test-key\n", "utf8");

      await expect(
        runLocalClawScanDryRun({
          cwd: root,
          path: folder,
          kind: "skill",
          env: {},
          fetchImpl: makeOpenAiFetch({}),
        }),
      ).rejects.toThrow("SKILL.md required");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires openclaw.plugin.json for plugin dry runs", async () => {
    const root = await makeTmpWorkdir();
    try {
      const folder = join(root, "plugin");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
      await writeFile(join(root, ".env.local"), "OPENAI_API_KEY=test-key\n", "utf8");

      await expect(
        runLocalClawScanDryRun({
          cwd: root,
          path: folder,
          kind: "plugin",
          env: {},
          fetchImpl: makeOpenAiFetch({}),
        }),
      ).rejects.toThrow("openclaw.plugin.json required");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs static scan and mocked LLM scan for a plugin folder", async () => {
    const root = await makeTmpWorkdir();
    try {
      const plugin = await writePlugin(root);
      await writeFile(join(root, ".env.local"), "OPENAI_API_KEY=test-key\n", "utf8");
      const fetchImpl = makeOpenAiFetch({
        verdict: "benign",
        confidence: "high",
        summary: "No concerning behavior found.",
        dimensions: {},
        user_guidance: "Looks fine for local testing.",
      });

      const result = await runLocalClawScanDryRun({
        cwd: root,
        path: plugin,
        kind: "plugin",
        env: {},
        fetchImpl,
        now: () => 123,
      });

      expect(result.kind).toBe("plugin");
      expect(result.staticScan.status).toBe("clean");
      expect(result.llmAnalysis).toMatchObject({
        status: "clean",
        verdict: "benign",
        confidence: "high",
        summary: "No concerning behavior found.",
        guidance: "Looks fine for local testing.",
      });
      expect(fetchImpl).toHaveBeenCalledWith(
        "https://api.openai.com/v1/responses",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
        }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
