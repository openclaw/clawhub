/* @vitest-environment node */

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiRoutes } from "clawhub-schema";
import { describe, expect, it } from "vitest";
import { buildE2ESkillMarkdown, makeTempConfig } from "./helpers/clawhubCli";

const OLD_CLI_COMPAT_VERSION = process.env.CLAWHUB_OLD_CLI_E2E_VERSION?.trim() || "0.14.0";

type CapturedFetch = {
  url: string;
  method: string | null;
  payload: Record<string, unknown>;
  files: Array<{ name: string; size: number; type: string }>;
};

async function writeOldCliFetchShim(dir: string) {
  const path = join(dir, "old-cli-fetch-shim.mjs");
  await writeFile(
    path,
    `import { appendFile } from "node:fs/promises";

const originalFetch = globalThis.fetch.bind(globalThis);
const captureBase = process.env.CLAWHUB_OLD_CLI_CAPTURE_BASE;
const captureLog = process.env.CLAWHUB_OLD_CLI_FETCH_LOG;

globalThis.fetch = async (url, init = {}) => {
  const urlString = String(url);
  if (!captureBase || !captureLog || !urlString.startsWith(captureBase)) {
    return originalFetch(url, init);
  }

  const form = init.body;
  const payloadText =
    form && typeof form.get === "function" && typeof form.get("payload") === "string"
      ? form.get("payload")
      : "{}";
  const files =
    form && typeof form.getAll === "function"
      ? form.getAll("files").map((file) => ({
          name: file.name ?? "",
          size: file.size ?? 0,
          type: file.type ?? "",
        }))
      : [];

  await appendFile(
    captureLog,
    JSON.stringify({
      url: urlString,
      method: init.method ?? null,
      payload: JSON.parse(payloadText),
      files,
    }) + "\\n",
  );

  return new Response(
    JSON.stringify({
      ok: true,
      skillId: "skills:old-cli",
      versionId: "skillVersions:old-cli",
      embeddingId: "skillEmbeddings:old-cli",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};
`,
    "utf8",
  );
  return path;
}

describe("CLI publish compatibility", () => {
  it("old CLI publish can omit ownerHandle against the compatibility endpoint", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "clawhub-old-cli-publish-"));
    const captureBase = "http://old-cli-compat.local";
    const cfg = await makeTempConfig(captureBase, "clh_old_cli_test");
    const fetchLog = join(workdir, "fetch-log.jsonl");
    const fetchShim = await writeOldCliFetchShim(workdir);
    const slug = `old-cli-${Date.now()}`;
    const skillDir = join(workdir, slug);

    try {
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), buildE2ESkillMarkdown(slug), "utf8");

      const result = spawnSync(
        "npm",
        [
          "exec",
          "--yes",
          "--package",
          `clawhub@${OLD_CLI_COMPAT_VERSION}`,
          "--",
          "clawhub",
          "--site",
          captureBase,
          "--registry",
          captureBase,
          "--workdir",
          workdir,
          "publish",
          skillDir,
          "--slug",
          slug,
          "--name",
          `Old CLI ${slug}`,
          "--version",
          "1.0.0",
          "--tags",
          "latest",
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            CLAWHUB_CONFIG_PATH: cfg.path,
            CLAWHUB_DISABLE_TELEMETRY: "1",
            CLAWHUB_OLD_CLI_CAPTURE_BASE: captureBase,
            CLAWHUB_OLD_CLI_FETCH_LOG: fetchLog,
            NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import ${fetchShim}`]
              .filter(Boolean)
              .join(" "),
          },
          encoding: "utf8",
          timeout: 120_000,
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).not.toMatch(/ownerHandle is required|Upgrade the ClawHub CLI/i);
      const captures = (await readFile(fetchLog, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as CapturedFetch);
      expect(captures).toHaveLength(1);
      const publish = captures[0];
      expect(publish.url).toBe(`${captureBase}${ApiRoutes.skills}`);
      expect(publish.method).toBe("POST");
      expect(publish.files.map((file) => file.name)).toEqual(["SKILL.md"]);
      expect(publish.payload).toMatchObject({
        slug,
        displayName: `Old CLI ${slug}`,
        version: "1.0.0",
        changelog: "",
        acceptLicenseTerms: true,
        tags: ["latest"],
      });
      expect(publish.payload).not.toHaveProperty("ownerHandle");
    } finally {
      await rm(workdir, { recursive: true, force: true });
      await rm(cfg.dir, { recursive: true, force: true });
    }
  }, 150_000);
});
