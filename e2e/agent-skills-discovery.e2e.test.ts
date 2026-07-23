/* @vitest-environment node */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentSkillsDiscoveryDocument } from "../convex/lib/agentSkillsDiscovery";
import { buildDeterministicZip } from "../convex/lib/skillZip";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Agent Skills CLI compatibility", () => {
  it("installs a ClawHub skill page URL with the real npx skills CLI", async () => {
    const skillMarkdown = `---
name: demo
description: Demonstrates ClawHub Agent Skills discovery.
---

# Demo

Installed from a ClawHub skill page URL.
`;
    const archive = buildDeterministicZip([
      { path: "SKILL.md", bytes: new TextEncoder().encode(skillMarkdown) },
      {
        path: "references/proof.txt",
        bytes: new TextEncoder().encode("supporting file installed"),
      },
    ]);
    const digest = createHash("sha256").update(archive).digest("hex");

    const server = createServer((request, response) => {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const url = new URL(request.url ?? "/", origin);

      if (url.pathname === "/openclaw/skills/demo/.well-known/agent-skills/index.json") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify(
            buildAgentSkillsDiscoveryDocument({
              origin,
              ownerHandle: "openclaw",
              slug: "demo",
              displayName: "Demo",
              description: "Demonstrates ClawHub Agent Skills discovery.",
              digest,
              version: "1.0.0",
            }),
          ),
        );
        return;
      }

      if (
        url.pathname === "/api/v1/agent-skills/openclaw/demo/archive" &&
        url.searchParams.get("version") === "1.0.0"
      ) {
        response.writeHead(200, { "Content-Type": "application/zip" });
        response.end(Buffer.from(archive));
        return;
      }

      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("not found");
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const projectDir = await mkdtemp(join(tmpdir(), "clawhub-agent-skills-e2e-"));
    tempDirs.push(projectDir);
    await writeFile(join(projectDir, "package.json"), '{"private":true}\n', "utf8");

    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const result = await execFileAsync(
      "npx",
      [
        "--yes",
        "skills@1.5.20",
        "add",
        `${origin}/openclaw/skills/demo`,
        "--agent",
        "codex",
        "--skill",
        "demo",
        "--yes",
        "--copy",
      ],
      {
        cwd: projectDir,
        encoding: "utf8",
        timeout: 90_000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          CI: "1",
          DO_NOT_TRACK: "1",
          NO_COLOR: "1",
        },
      },
    );

    expect(result.stderr).not.toContain("Error");
    expect(await readFile(join(projectDir, ".agents/skills/demo/SKILL.md"), "utf8")).toContain(
      "Installed from a ClawHub skill page URL.",
    );
    expect(
      await readFile(join(projectDir, ".agents/skills/demo/references/proof.txt"), "utf8"),
    ).toBe("supporting file installed");
  }, 120_000);
});
