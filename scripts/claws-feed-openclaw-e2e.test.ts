import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { EXPERIMENTAL_CLAW_FEED_ID, serializeExperimentalClawFeed } from "clawhub-schema";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertSafeClawArchive,
  extractSafeClawZip,
  findExtractedPackageRoot,
  readResponseBytesBounded,
  runPublishedClawDryRun,
  selectPublishedClaw,
} from "./claws-feed-openclaw-e2e";

const execFileAsync = promisify(execFile);
const openclawRepo = process.env.OPENCLAW_CLAWS_CHECKOUT;
const fixtureRoot = resolve("fixtures/claws/hosted-e2e");
let tempRoot = "";
let archiveBytes = new Uint8Array();
let integrity = "";
let server: Server | undefined;
let serverPort = 0;

function feedValue() {
  const now = Date.now();
  return JSON.parse(
    serializeExperimentalClawFeed({
      schemaVersion: 1,
      id: EXPERIMENTAL_CLAW_FEED_ID,
      generatedAt: new Date(now).toISOString(),
      sequence: 1,
      expiresAt: new Date(now + 86_400_000).toISOString(),
      entries: [
        {
          type: "claw",
          id: "@openclaw/hosted-e2e",
          title: "Hosted E2E",
          version: "1.0.0",
          state: "available",
          publisher: { id: "openclaw", trust: "official" },
          clawManifestSummary: {
            schemaVersion: 1,
            agent: { id: "hosted-e2e", name: "Hosted E2E" },
            workspace: { bootstrapFiles: ["SOUL.md"], fileCount: 0 },
            packages: { skillCount: 0, pluginCount: 0 },
            mcpServerCount: 0,
            cronJobCount: 0,
          },
          install: {
            candidates: [
              {
                sourceRef: "public-clawhub",
                package: "@openclaw/hosted-e2e",
                version: "1.0.0",
                integrity,
              },
            ],
          },
        },
      ],
    }),
  );
}

describe("published Claw to OpenClaw dry-run proof", () => {
  beforeAll(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "clawhub-hosted-e2e-fixture-"));
    const archivePath = join(tempRoot, "claw.tgz");
    await execFileAsync("tar", ["-czf", archivePath, "package"], { cwd: fixtureRoot });
    archiveBytes = new Uint8Array(await readFile(archivePath));
    integrity = `sha256:${createHash("sha256").update(archiveBytes).digest("hex")}`;
    server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (pathname === "/v1/feeds/claws") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(feedValue()));
        return;
      }
      if (pathname.endsWith("/artifact")) {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            artifact: {
              kind: "npm-pack",
              sha256: integrity.slice("sha256:".length),
              downloadUrl: "/download.tgz",
            },
          }),
        );
        return;
      }
      if (pathname === "/download.tgz") {
        response.setHeader("Content-Type", "application/gzip");
        response.end(archiveBytes);
        return;
      }
      response.statusCode = 404;
      response.end("Not found");
    });
    await new Promise<void>((resolveListen) => server!.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server did not bind");
    serverPort = address.port;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolveClose) => server!.close(() => resolveClose()));
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  });

  it("selects only the exact public ClawHub candidate", () => {
    const selected = selectPublishedClaw(feedValue(), "@openclaw/hosted-e2e");
    expect(selected.candidate).toMatchObject({ version: "1.0.0", integrity });
    expect(() => selectPublishedClaw(feedValue(), "@openclaw/missing")).toThrow("was not present");
  });

  it.skipIf(process.platform === "win32")(
    "rejects link entries before extracting a published artifact",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "clawhub-hosted-e2e-link-"));
      try {
        const packageRoot = join(root, "package");
        const archivePath = join(root, "linked.tgz");
        await mkdir(packageRoot);
        await writeFile(join(packageRoot, "package.json"), "{}\n");
        await symlink("../../outside", join(packageRoot, "workspace"));
        await execFileAsync("tar", ["-czf", archivePath, "package"], { cwd: root });

        await expect(assertSafeClawArchive(archivePath)).rejects.toThrow(
          "only contain regular files and directories",
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("extracts legacy ZIP artifacts without permitting traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "clawhub-hosted-e2e-zip-"));
    try {
      const archive = zipSync({
        "package/package.json": strToU8("{}\n"),
        "package/CLAW.md": strToU8("---\nschemaVersion: 1\n---\n"),
      });
      await extractSafeClawZip(archive, root);
      await expect(readFile(join(root, "package", "package.json"), "utf8")).resolves.toBe("{}\n");

      const unsafeArchive = zipSync({ "../outside": strToU8("unsafe") });
      await expect(extractSafeClawZip(unsafeArchive, root)).rejects.toThrow("unsafe path");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("discovers legacy ZIP packages extracted directly at the archive root", async () => {
    const root = await mkdtemp(join(tmpdir(), "clawhub-hosted-e2e-root-zip-"));
    try {
      const archive = zipSync({
        "package.json": strToU8("{}\n"),
        "CLAW.md": strToU8("---\nschemaVersion: 1\n---\n"),
      });
      await extractSafeClawZip(archive, root);
      await expect(findExtractedPackageRoot(root)).resolves.toBe(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects ZIP artifacts whose expanded content exceeds the package limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "clawhub-hosted-e2e-large-zip-"));
    try {
      const archive = zipSync({ "package/large.bin": new Uint8Array(50 * 1024 * 1024 + 1) });
      await expect(extractSafeClawZip(archive, root)).rejects.toThrow("50MB unpacked limit");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects oversized downloads from metadata before buffering the body", async () => {
    const response = new Response("", { headers: { "Content-Length": String(65 * 1024 * 1024) } });
    await expect(readResponseBytesBounded(response)).rejects.toThrow("64MB download limit");
  });

  it.skipIf(!openclawRepo)(
    "runs the downloaded package through OpenClaw dry-run",
    async () => {
      const origin = `http://127.0.0.1:${serverPort}`;
      const result = await runPublishedClawDryRun({
        feedUrl: `${origin}/v1/feeds/claws`,
        packageName: "@openclaw/hosted-e2e",
        registryUrl: origin,
        openclawRepo: openclawRepo!,
      });
      expect(result.plan).toMatchObject({
        schemaVersion: "openclaw.clawAddPlan.v1",
        dryRun: true,
        mutationAllowed: false,
        agent: { finalId: "hosted-e2e" },
        summary: { blockedActions: 0 },
      });
    },
    30_000,
  );
});
