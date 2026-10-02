import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type APIRequestContext, test } from "@playwright/test";
import { claimMockPrePublicationChecks, completeMockPrePublicationChecks } from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "Claw publisher boundaries require the isolated local-auth runner",
);
test.setTimeout(600_000);

type TokenFixture = {
  admin: { handle: string; token: string };
  user: { handle: string; token: string };
};

type PackedFixture = {
  name: string;
  version: string;
  bytes: Buffer;
  filename: string;
  sha256: string;
};

function registryUrl() {
  const raw = process.env.VITE_CONVEX_SITE_URL;
  if (!raw || new URL(raw).hostname !== "127.0.0.1") {
    throw new Error("Claw boundary proof requires a 127.0.0.1 Convex site URL");
  }
  return raw.replace(/\/$/u, "");
}

function localDeployment() {
  const raw = readFileSync(".convex/local/default/config.json", "utf8");
  const config = JSON.parse(raw) as { deploymentName?: unknown };
  if (typeof config.deploymentName !== "string" || !config.deploymentName) {
    throw new Error("Isolated local Convex deployment was not available");
  }
  return config.deploymentName.startsWith("anonymous-")
    ? `anonymous:${config.deploymentName}`
    : `local:${config.deploymentName}`;
}

function runLocalConvex(functionName: string, args: Record<string, unknown>) {
  const result = spawnSync(
    "bunx",
    [
      "convex",
      "run",
      "--no-push",
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
      functionName,
      JSON.stringify(args),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, CONVEX_DEPLOYMENT: localDeployment() },
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(`Local Convex ${functionName} failed:\n${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout) as unknown;
}

function packFixture(root: string, name: string, files: Record<string, string>): PackedFixture {
  const sourceDir = path.join(root, name.replaceAll(/[/@]/gu, "-"));
  for (const [file, contents] of Object.entries(files)) {
    const filePath = path.join(sourceDir, file);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents);
  }
  const pack = spawnSync("npm", ["pack", "--json", "--pack-destination", root], {
    cwd: sourceDir,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (pack.status !== 0) throw new Error(`npm pack failed:\n${pack.stderr || pack.stdout}`);
  const parsed = JSON.parse(pack.stdout) as Array<{ filename: string }>;
  const filename = parsed[0]?.filename;
  if (!filename) throw new Error("npm pack did not return a tarball filename");
  const bytes = readFileSync(path.join(root, filename));
  return {
    name,
    version: "1.0.0",
    bytes,
    filename,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function clawFixture(root: string, owner: string, slug: string) {
  const name = `@${owner}/${slug}`;
  return packFixture(root, name, {
    "package.json": JSON.stringify({
      name,
      version: "1.0.0",
      openclaw: { claw: "manifests/CLAW.md" },
    }),
    "manifests/CLAW.md": `---\nschemaVersion: 1\nagent:\n  id: ${slug}\n  name: ${slug}\n---\n# ${slug}\n\nLocal Claw publication proof.\n`,
    "profiles/openclaw.yml": "schemaVersion: 1\nagent: {}\n",
  });
}

function pluginFixture(root: string, slug: string) {
  const name = `@openclaw/${slug}`;
  return packFixture(root, name, {
    "package.json": JSON.stringify({
      name,
      version: "1.0.0",
      type: "module",
      main: "dist/index.js",
      files: ["dist", "openclaw.plugin.json", "README.md"],
      openclaw: {
        extensions: ["./dist/index.js"],
        compat: { pluginApi: ">=2026.3.24-beta.2" },
        build: { openclawVersion: "2026.3.24-beta.2" },
        configSchema: { type: "object", additionalProperties: false },
      },
    }),
    "openclaw.plugin.json": JSON.stringify({
      id: slug,
      name: slug,
      configSchema: { type: "object", additionalProperties: false },
    }),
    "README.md": `# ${slug}\n\nLocal plugin control for the Claw Official gate.\n`,
    "dist/index.js": "export function register() { return { ok: true }; }\n",
  });
}

async function publishPackage(
  request: APIRequestContext,
  registry: string,
  token: string,
  fixture: PackedFixture,
  family: "claw" | "code-plugin",
) {
  const payload = {
    name: fixture.name,
    ownerHandle: fixture.name.split("/")[0]?.slice(1),
    displayName: fixture.name,
    family,
    version: fixture.version,
    changelog: "Local boundary proof",
    tags: ["latest"],
    ...(family === "claw" ? { expectedArtifactSha256: fixture.sha256 } : {}),
    ...(family === "code-plugin"
      ? {
          source: {
            kind: "github",
            url: "https://github.com/openclaw/clawhub",
            repo: "openclaw/clawhub",
            ref: "refs/heads/main",
            commit: "0123456789abcdef0123456789abcdef01234567",
            path: ".",
            importedAt: Date.now(),
          },
        }
      : {}),
  };
  return await request.post(`${registry}/api/v1/packages`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      payload: JSON.stringify(payload),
      clawpack: {
        name: fixture.filename,
        mimeType: "application/octet-stream",
        buffer: fixture.bytes,
      },
    },
    timeout: 120_000,
  });
}

async function createPublisher(
  request: APIRequestContext,
  registry: string,
  token: string,
  handle: string,
) {
  const response = await request.post(`${registry}/api/v1/publishers`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { handle, displayName: handle },
  });
  expect(response.status(), await response.text()).toBe(201);
}

async function ensureOpenClawPublisher(
  request: APIRequestContext,
  registry: string,
  token: string,
  memberHandle: string,
) {
  const response = await request.post(`${registry}/api/v1/users/publisher`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      handle: "openclaw",
      displayName: "OpenClaw",
      memberHandle,
      memberRole: "owner",
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  expect((await response.json()) as Record<string, unknown>).toMatchObject({
    ok: true,
    handle: "openclaw",
    created: true,
  });
}

async function setOfficial(
  request: APIRequestContext,
  registry: string,
  token: string,
  action: "add" | "remove",
) {
  const response = await request.post(`${registry}/api/v1/users/publisher-official`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { action, handle: "openclaw", reason: "Isolated local Claw boundary proof" },
  });
  expect(response.status(), await response.text()).toBe(200);
  expect((await response.json()) as { [key: string]: unknown }).toMatchObject({
    ok: true,
    [action === "add" ? "added" : "removed"]: true,
  });
}

async function searchNames(request: APIRequestContext, registry: string, slug: string) {
  const response = await request.get(
    `${registry}/api/v1/packages/search?q=${encodeURIComponent(slug)}&family=claw`,
  );
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as { results: Array<{ package: { name: string } }> };
  return body.results.map((item) => item.package.name);
}

test("current Official @openclaw owns every Claw publish and public-read boundary", async ({
  request,
}) => {
  const registry = registryUrl();
  const tokens = runLocalConvex("devSeed:seedCliRoleHelpFixtures", {}) as TokenFixture;
  const root = mkdtempSync(path.join(tmpdir(), "clawhub-official-boundary-"));
  const suffix = Date.now().toString(36);
  const visibleSlug = `pw-official-${suffix}`;
  const raceSlug = `pw-revoke-race-${suffix}`;
  const deniedSlug = `pw-revoked-${suffix}`;
  const pluginSlug = `pw-plugin-control-${suffix}`;
  const visible = clawFixture(root, "openclaw", visibleSlug);
  const race = clawFixture(root, "openclaw", raceSlug);
  const denied = clawFixture(root, "openclaw", deniedSlug);
  const community = clawFixture(root, "community-proof", `pw-community-${suffix}`);
  const plugin = pluginFixture(root, pluginSlug);

  try {
    await ensureOpenClawPublisher(request, registry, tokens.admin.token, tokens.admin.handle);
    await createPublisher(request, registry, tokens.user.token, "community-proof");
    await setOfficial(request, registry, tokens.admin.token, "add");

    const communityPublish = await publishPackage(
      request,
      registry,
      tokens.user.token,
      community,
      "claw",
    );
    expect(communityPublish.status()).toBe(400);
    expect(await communityPublish.text()).toContain("limited to the @openclaw publisher");

    const admitted = await publishPackage(request, registry, tokens.admin.token, visible, "claw");
    expect(admitted.status(), await admitted.text()).toBe(200);
    expect((await admitted.json()) as Record<string, unknown>).toMatchObject({
      publicationStatus: "pending",
      artifactSha256: visible.sha256,
    });
    const privateRead = await request.get(
      `${registry}/api/v1/packages/${encodeURIComponent(visible.name)}`,
    );
    expect(privateRead.status()).toBe(404);
    await completeMockPrePublicationChecks({
      kind: "package",
      slug: visible.name,
      version: visible.version,
    });

    const directUrl = `${registry}/api/v1/packages/${encodeURIComponent(visible.name)}`;
    await expect
      .poll(async () => (await request.get(directUrl)).status(), { timeout: 60_000 })
      .toBe(200);
    const direct = await request.get(directUrl);
    const directBody = (await direct.json()) as {
      package: { name: string; family: string; channel: string; isOfficial: boolean };
    };
    expect(directBody.package).toMatchObject({
      name: visible.name,
      family: "claw",
      channel: "official",
      isOfficial: true,
    });
    expect(await searchNames(request, registry, visibleSlug)).toContain(visible.name);
    const artifact = await request.get(
      `${directUrl}/versions/${visible.version}/artifact/download`,
    );
    expect(artifact.status(), await artifact.text()).toBe(200);
    expect(
      createHash("sha256")
        .update(await artifact.body())
        .digest("hex"),
    ).toBe(visible.sha256);

    runLocalConvex("catalogFeed:publish", {
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const feedUrl = `${registry}/api/v1/feeds/claws`;
    const feed = await request.get(feedUrl);
    expect(feed.status(), await feed.text()).toBe(200);
    const feedBody = (await feed.json()) as {
      entries: Array<{ id: string; publisher: { id: string; trust: string } }>;
    };
    expect(feedBody.entries).toContainEqual(
      expect.objectContaining({
        id: visible.name,
        publisher: { id: "openclaw", trust: "official" },
      }),
    );

    const raceAdmission = await publishPackage(request, registry, tokens.admin.token, race, "claw");
    expect(raceAdmission.status(), await raceAdmission.text()).toBe(200);
    expect((await raceAdmission.json()) as Record<string, unknown>).toMatchObject({
      publicationStatus: "pending",
    });
    const raceClaim = await claimMockPrePublicationChecks({
      kind: "package",
      slug: race.name,
      version: race.version,
    });
    await setOfficial(request, registry, tokens.admin.token, "remove");
    await expect(
      completeMockPrePublicationChecks({
        kind: "package",
        slug: race.name,
        version: race.version,
        claim: raceClaim,
      }),
    ).rejects.toThrow(/active official @openclaw publisher/);

    const revokedPublish = await publishPackage(
      request,
      registry,
      tokens.admin.token,
      denied,
      "claw",
    );
    expect(revokedPublish.status()).toBe(400);
    expect(await revokedPublish.text()).toContain("active official @openclaw publisher");
    expect((await request.get(directUrl)).status()).toBe(404);
    expect(
      (await request.get(`${registry}/api/v1/packages/${encodeURIComponent(race.name)}`)).status(),
    ).toBe(404);
    expect(await searchNames(request, registry, visibleSlug)).not.toContain(visible.name);
    const staleFeed = await request.get(feedUrl, {
      headers: { "If-None-Match": feed.headers().etag ?? "" },
    });
    expect(staleFeed.status()).toBe(503);
    expect(staleFeed.headers()["cache-control"]).toBe("no-store");

    runLocalConvex("catalogFeed:publish", {
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const rebuiltFeed = await request.get(feedUrl);
    expect(rebuiltFeed.status(), await rebuiltFeed.text()).toBe(200);
    expect((await rebuiltFeed.json()) as { entries: unknown[] }).toMatchObject({ entries: [] });

    const pluginAdmission = await publishPackage(
      request,
      registry,
      tokens.admin.token,
      plugin,
      "code-plugin",
    );
    expect(pluginAdmission.status(), await pluginAdmission.text()).toBe(200);
    expect((await pluginAdmission.json()) as Record<string, unknown>).toMatchObject({
      publicationStatus: "pending",
    });
    await completeMockPrePublicationChecks({
      kind: "package",
      slug: plugin.name,
      version: plugin.version,
    });
    const pluginRead = await request.get(
      `${registry}/api/v1/packages/${encodeURIComponent(plugin.name)}`,
    );
    expect(pluginRead.status(), await pluginRead.text()).toBe(200);
    expect((await pluginRead.json()) as { package: { family: string } }).toMatchObject({
      package: { family: "code-plugin" },
    });

    console.log(
      `CLAW_OFFICIAL_BOUNDARY_PROOF ${JSON.stringify({
        registry,
        officialPublish: "pending-to-published",
        officialRead: "200-to-404-after-revocation",
        officialSearch: "included-to-excluded-after-revocation",
        officialFeed: "200-to-503-after-revocation-then-empty-after-rebuild",
        communityClawPublish: communityPublish.status(),
        revokedClawPublish: revokedPublish.status(),
        revocationRace: "finalization-denied",
        pluginAfterRevocation: pluginRead.status(),
      })}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
