/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/apiTokenAuth", () => ({
  getOptionalApiTokenUser: vi.fn(),
  requireApiTokenUser: vi.fn(),
  requirePackagePublishAuth: vi.fn(),
}));

vi.mock("./skills", () => ({
  publishVersionForUser: vi.fn(),
}));

const { getOptionalApiTokenUser, requireApiTokenUser, requirePackagePublishAuth } =
  await import("./lib/apiTokenAuth");
const { publishVersionForUser } = await import("./skills");
const { __handlers } = await import("./httpApi");
const { hashSkillFiles } = await import("./lib/skills");

function makeCtx(partial: Record<string, unknown>) {
  const partialRunMutation =
    typeof partial.runMutation === "function"
      ? (partial.runMutation as (mutation: unknown, args: Record<string, unknown>) => unknown)
      : null;
  const runMutation = vi.fn(async (mutation: unknown, args: Record<string, unknown>) => {
    if (
      typeof args.name === "string" &&
      typeof args.key === "string" &&
      typeof args.ttlMs === "number" &&
      !("config" in args)
    ) {
      return { action: "retained" };
    }
    return partialRunMutation ? await partialRunMutation(mutation, args) : null;
  });
  return { ...partial, runMutation } as unknown as import("./_generated/server").ActionCtx;
}

describe("httpApi handlers", () => {
  afterEach(() => {
    vi.mocked(getOptionalApiTokenUser).mockReset();
    vi.mocked(requireApiTokenUser).mockReset();
    vi.mocked(requirePackagePublishAuth).mockReset();
    vi.mocked(publishVersionForUser).mockReset();
  });

  it("searchSkillsHttp returns empty results for empty query", async () => {
    const response = await __handlers.searchSkillsHandler(
      makeCtx({ runAction: vi.fn() }),
      new Request("https://example.com/api/search?q=%20%20"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [] });
  });

  it("searchSkillsHttp forwards args (approvedOnly alias)", async () => {
    const runAction = vi.fn().mockResolvedValue([
      {
        score: 1,
        skill: { slug: "a", displayName: "A", summary: null, updatedAt: 1 },
        ownerHandle: "openclaw",
        version: null,
      },
    ]);
    const response = await __handlers.searchSkillsHandler(
      makeCtx({ runAction }),
      new Request("https://example.com/api/search?q=test&approvedOnly=true&limit=5"),
    );
    expect(runAction).toHaveBeenCalledWith(expect.anything(), {
      query: "test",
      limit: 5,
      highlightedOnly: true,
      nonSuspiciousOnly: undefined,
    });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.results[0].slug).toBe("a");
    expect(json.results[0].ownerHandle).toBe("openclaw");
  });

  it("searchSkillsHttp forwards highlightedOnly", async () => {
    const runAction = vi.fn().mockResolvedValue([]);
    await __handlers.searchSkillsHandler(
      makeCtx({ runAction }),
      new Request("https://example.com/api/search?q=test&highlightedOnly=true"),
    );
    expect(runAction).toHaveBeenCalledWith(expect.anything(), {
      query: "test",
      limit: undefined,
      highlightedOnly: true,
      nonSuspiciousOnly: undefined,
    });
  });

  it("searchSkillsHttp omits highlightedOnly when approvedOnly is false", async () => {
    const runAction = vi.fn().mockResolvedValue([]);
    await __handlers.searchSkillsHandler(
      makeCtx({ runAction }),
      new Request("https://example.com/api/search?q=test&approvedOnly=false"),
    );
    expect(runAction).toHaveBeenCalledWith(expect.anything(), {
      query: "test",
      limit: undefined,
      highlightedOnly: undefined,
      nonSuspiciousOnly: undefined,
    });
  });

  it("searchSkillsHttp forwards nonSuspiciousOnly", async () => {
    const runAction = vi.fn().mockResolvedValue([]);
    await __handlers.searchSkillsHandler(
      makeCtx({ runAction }),
      new Request("https://example.com/api/search?q=test&nonSuspiciousOnly=1"),
    );
    expect(runAction).toHaveBeenCalledWith(expect.anything(), {
      query: "test",
      limit: undefined,
      highlightedOnly: undefined,
      nonSuspiciousOnly: true,
    });
  });

  it("searchSkillsHttp forwards legacy nonSuspicious alias", async () => {
    const runAction = vi.fn().mockResolvedValue([]);
    await __handlers.searchSkillsHandler(
      makeCtx({ runAction }),
      new Request("https://example.com/api/search?q=test&nonSuspicious=1"),
    );
    expect(runAction).toHaveBeenCalledWith(expect.anything(), {
      query: "test",
      limit: undefined,
      highlightedOnly: undefined,
      nonSuspiciousOnly: true,
    });
  });

  it("searchSkillsHttp prefers canonical nonSuspiciousOnly over legacy alias", async () => {
    const runAction = vi.fn().mockResolvedValue([]);
    await __handlers.searchSkillsHandler(
      makeCtx({ runAction }),
      new Request("https://example.com/api/search?q=test&nonSuspiciousOnly=false&nonSuspicious=1"),
    );
    expect(runAction).toHaveBeenCalledWith(expect.anything(), {
      query: "test",
      limit: undefined,
      highlightedOnly: undefined,
      nonSuspiciousOnly: undefined,
    });
  });

  it("getSkillHttp validates slug", async () => {
    const response = await __handlers.getSkillHandler(
      makeCtx({ runQuery: vi.fn() }),
      new Request("https://example.com/api/skill"),
    );
    expect(response.status).toBe(400);
  });

  it("getSkillHttp returns 404 when missing", async () => {
    const runQuery = vi.fn().mockResolvedValue(null);
    const response = await __handlers.getSkillHandler(
      makeCtx({ runQuery }),
      new Request("https://example.com/api/skill?slug=missing"),
    );
    expect(response.status).toBe(404);
  });

  it("getSkillHttp returns ownerHandle guidance when the slug is ambiguous", async () => {
    const runQuery = vi.fn().mockResolvedValue({ skill: null, ambiguous: true });
    const response = await __handlers.getSkillHandler(
      makeCtx({ runQuery }),
      new Request("https://example.com/api/skill?slug=demo"),
    );

    expect(response.status).toBe(409);
    const body = await response.text();
    expect(body).toContain('Ambiguous skill slug "demo"');
    expect(body).toContain("/api/skill?slug=demo&ownerHandle=<owner>");
  });

  it("getSkillHttp returns payload with owner and latestVersion", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      skill: {
        slug: "demo",
        displayName: "Demo",
        summary: "x",
        tags: {},
        stats: {
          downloads: 0,
          installsCurrent: 0,
          installsAllTime: 0,
          stars: 0,
          versions: 1,
          comments: 0,
        },
        createdAt: 1,
        updatedAt: 2,
      },
      latestVersion: { version: "1.0.0", createdAt: 3, changelog: "c" },
      owner: { handle: "p", displayName: "Peter", image: null },
    });
    const response = await __handlers.getSkillHandler(
      makeCtx({ runQuery }),
      new Request("https://example.com/api/skill?slug=demo"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.skill.slug).toBe("demo");
    expect(json.latestVersion.version).toBe("1.0.0");
    expect(json.owner.handle).toBe("p");
  });

  it("getSkillHttp returns payload with null owner/latestVersion", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      skill: {
        slug: "demo",
        displayName: "Demo",
        summary: null,
        tags: {},
        stats: {},
        createdAt: 1,
        updatedAt: 2,
      },
      latestVersion: null,
      owner: null,
    });
    const response = await __handlers.getSkillHandler(
      makeCtx({ runQuery }),
      new Request("https://example.com/api/skill?slug=demo"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.latestVersion).toBeNull();
    expect(json.owner).toBeNull();
  });

  it("resolveSkillVersionHttp validates hash", async () => {
    const response = await __handlers.resolveSkillVersionHandler(
      makeCtx({ runQuery: vi.fn() }),
      new Request("https://example.com/api/skill/resolve?slug=demo&hash=bad"),
    );
    expect(response.status).toBe(400);
  });

  it("resolveSkillVersionHttp returns 404 when missing", async () => {
    const runQuery = vi.fn().mockResolvedValue(null);
    const response = await __handlers.resolveSkillVersionHandler(
      makeCtx({ runQuery }),
      new Request(
        "https://example.com/api/skill/resolve?slug=missing&hash=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    );
    expect(response.status).toBe(404);
  });

  it("resolveSkillVersionHttp returns ownerHandle guidance when the slug is ambiguous", async () => {
    const hash = "a".repeat(64);
    const runQuery = vi.fn().mockResolvedValue({
      match: null,
      latestVersion: null,
      ambiguous: true,
    });
    const response = await __handlers.resolveSkillVersionHandler(
      makeCtx({ runQuery }),
      new Request(`https://example.com/api/skill/resolve?slug=demo&hash=${hash}`),
    );

    expect(response.status).toBe(409);
    const body = await response.text();
    expect(body).toContain('Ambiguous skill slug "demo"');
    expect(body).toContain(`/api/skill/resolve?slug=demo&ownerHandle=<owner>&hash=${hash}`);
  });

  it("resolveSkillVersionHttp returns match and latestVersion", async () => {
    const matchHash = await hashSkillFiles([{ path: "SKILL.md", sha256: "abc" }]);
    const runQuery = vi.fn().mockResolvedValueOnce({
      match: { version: "1.0.0" },
      latestVersion: { version: "2.0.0" },
    });

    const response = await __handlers.resolveSkillVersionHandler(
      makeCtx({ runQuery }),
      new Request(`https://example.com/api/skill/resolve?slug=demo&hash=${matchHash}`),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.match.version).toBe("1.0.0");
    expect(json.latestVersion.version).toBe("2.0.0");
  });

  it("cliWhoamiHttp returns 401 on auth failure", async () => {
    vi.mocked(requireApiTokenUser).mockRejectedValueOnce(
      new Error(
        "Unauthorized: This ClawHub account is not in good standing and cannot use API tokens. If you believe this is a mistake, open a GitHub issue: https://github.com/openclaw/clawhub/issues/new.",
      ),
    );
    const response = await __handlers.cliWhoamiHandler(
      makeCtx({}),
      new Request("https://x/api/cli/whoami"),
    );
    expect(response.status).toBe(401);
    expect(await response.text()).toContain("not in good standing");
  });

  it("cliWhoamiHttp returns user payload on success", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({
      user: { handle: "p", displayName: "Peter", image: "x" },
    } as never);
    const response = await __handlers.cliWhoamiHandler(
      makeCtx({}),
      new Request("https://x/api/cli/whoami"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.user.handle).toBe("p");
  });

  it("cliTelemetryInstallHttp forwards one install event and returns ok", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({ userId: "users:1" } as never);
    const runMutation = vi.fn().mockResolvedValue(null);
    const response = await __handlers.cliTelemetryInstallHandler(
      makeCtx({ runMutation }),
      new Request("https://x/api/cli/telemetry/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "install",
          slug: "weather",
          ownerHandle: "openclaw",
          sourceRef: "skills-sh:openclaw/skills/weather",
          sourceKind: "skills-sh",
          sourceRepository: "openclaw/skills",
          sourcePath: "skills/weather",
          sourceUrl:
            "https://github.com/openclaw/skills/tree/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/skills/weather",
          canonicalRef: "@openclaw/weather",
          clawhubScan: "scanned",
          trustLabel: "Scanned by ClawHub",
          version: "a".repeat(40),
          rootId: "abc",
          rootLabel: "~/skills",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      userId: "users:1",
      slug: "weather",
      ownerHandle: "openclaw",
      sourceRef: "skills-sh:openclaw/skills/weather",
      sourceKind: "skills-sh",
      sourceRepository: "openclaw/skills",
      sourcePath: "skills/weather",
      sourceUrl:
        "https://github.com/openclaw/skills/tree/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/skills/weather",
      canonicalRef: "@openclaw/weather",
      clawhubScan: "scanned",
      trustLabel: "Scanned by ClawHub",
      version: "a".repeat(40),
    });
  });

  it("cliTelemetryInstallHttp accepts legacy roots snapshots", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({ userId: "users:1" } as never);
    const runMutation = vi.fn().mockResolvedValue(null);
    const response = await __handlers.cliTelemetryInstallHandler(
      makeCtx({ runMutation }),
      new Request("https://x/api/cli/telemetry/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roots: [
            {
              rootId: "abc",
              label: "~/skills",
              skills: [
                { slug: "weather", version: "1.0.0" },
                { slug: "calendar", version: null },
              ],
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      userId: "users:1",
      skills: [
        { slug: "weather", version: "1.0.0" },
        { slug: "calendar", version: undefined },
      ],
    });
  });

  it("cliTelemetryInstallHttp chunks large legacy roots snapshots", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({ userId: "users:1" } as never);
    const runMutation = vi.fn().mockResolvedValue(null);
    const skills = Array.from({ length: 101 }, (_, index) => ({
      slug: `skill-${index}`,
      version: "1.0.0",
    }));

    const response = await __handlers.cliTelemetryInstallHandler(
      makeCtx({ runMutation }),
      new Request("https://x/api/cli/telemetry/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roots: [{ rootId: "abc", label: "~/skills", skills }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      userId: "users:1",
      skills: skills.slice(0, 100),
    });
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
      userId: "users:1",
      skills: skills.slice(100),
    });
  });

  it("cliDeviceCodeHttp rate limits and creates a device code", async () => {
    vi.mocked(getOptionalApiTokenUser).mockResolvedValueOnce(null);
    const result = {
      device_code: "device",
      user_code: "ABCD-2345",
      verification_uri: "https://clawhub.ai/cli/device?user_code=ABCD-2345",
      expires_in: 900,
      interval: 5,
    };
    const runQuery = vi.fn();
    const runMutation = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(result);

    const response = await __handlers.cliDeviceCodeHandler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://x/api/cli/device/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "read write",
          label: "ssh box",
          site_url: "https://clawhub.ai",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("RateLimit-Limit")).toBe("300");
    expect(await response.json()).toEqual(result);
    expect(runMutation).toHaveBeenLastCalledWith(expect.anything(), {
      scope: "read write",
      label: "ssh box",
      siteUrl: "https://clawhub.ai",
    });
  });

  it("cliDeviceTokenHttp requires the device grant type", async () => {
    vi.mocked(getOptionalApiTokenUser).mockResolvedValueOnce(null);
    const runQuery = vi.fn();
    const runMutation = vi.fn().mockResolvedValueOnce({ ok: true });

    const response = await __handlers.cliDeviceTokenHandler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://x/api/cli/device/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: "device" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "unsupported_grant_type" });
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it("cliDeviceTokenHttp returns pending as retryable", async () => {
    vi.mocked(getOptionalApiTokenUser).mockResolvedValueOnce(null);
    const runQuery = vi.fn();
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ error: "authorization_pending" });

    const response = await __handlers.cliDeviceTokenHandler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://x/api/cli/device/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_code: "device",
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      }),
    );

    expect(response.status).toBe(428);
    expect(await response.json()).toEqual({ error: "authorization_pending" });
  });

  it("cliUploadUrlHttp returns uploadUrl", async () => {
    vi.mocked(requirePackagePublishAuth).mockResolvedValueOnce({
      kind: "user",
      userId: "user1",
    } as never);
    const runMutation = vi.fn().mockResolvedValue({
      uploadUrl: "https://upload.local",
      uploadTicket: "packagePublishUploadTickets:1",
    });
    const response = await __handlers.cliUploadUrlHandler(
      makeCtx({ runMutation }),
      new Request("https://x/api/cli/upload-url", { method: "POST" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      uploadUrl: "https://upload.local",
      uploadTicket: "packagePublishUploadTickets:1",
    });
  });

  it("cliUploadUrlHttp accepts package publish tokens", async () => {
    vi.mocked(requirePackagePublishAuth).mockResolvedValueOnce({
      kind: "github-actions",
      publishToken: { _id: "packagePublishTokens:1" },
    } as never);
    const runMutation = vi.fn().mockResolvedValue({
      uploadUrl: "https://upload.local/package",
      uploadTicket: "packagePublishUploadTickets:2",
    });
    const response = await __handlers.cliUploadUrlHandler(
      makeCtx({ runMutation }),
      new Request("https://x/api/cli/upload-url", { method: "POST" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      uploadUrl: "https://upload.local/package",
      uploadTicket: "packagePublishUploadTickets:2",
    });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ publishTokenId: "packagePublishTokens:1" }),
    );
  });

  it("cliUploadUrlHttp returns 401 when unauthorized", async () => {
    vi.mocked(requirePackagePublishAuth).mockRejectedValueOnce(new Error("Unauthorized"));
    const response = await __handlers.cliUploadUrlHandler(
      makeCtx({}),
      new Request("https://x/api/cli/upload-url", { method: "POST" }),
    );
    expect(response.status).toBe(401);
  });

  it("cliPublishHttp returns 400 on invalid json", async () => {
    const request = new Request("https://x/api/cli/publish", { method: "POST", body: "{" });
    const response = await __handlers.cliPublishHandler(makeCtx({}), request);
    expect(response.status).toBe(400);
  });

  it("cliPublishHttp returns 401 when unauthorized", async () => {
    vi.mocked(requireApiTokenUser).mockRejectedValueOnce(new Error("Unauthorized"));
    const request = new Request("https://x/api/cli/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const response = await __handlers.cliPublishHandler(makeCtx({}), request);
    expect(response.status).toBe(401);
  });

  it("cliPublishHttp returns 400 on publish error", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({ userId: "user1" } as never);
    vi.mocked(publishVersionForUser).mockRejectedValueOnce(new Error("Nope"));
    const request = new Request("https://x/api/cli/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "cool-skill",
        displayName: "Cool Skill",
        ownerHandle: "me",
        version: "1.2.3",
        changelog: "c",
        acceptLicenseTerms: true,
        forkOf: { slug: "upstream", ownerHandle: "@openclaw", version: "1.0.0" },
        files: [{ path: "SKILL.md", size: 1, storageId: "id", sha256: "a" }],
      }),
    });
    const response = await __handlers.cliPublishHandler(
      makeCtx({ runMutation: vi.fn().mockResolvedValue({ publisherId: "publishers:me" }) }),
      request,
    );
    expect(response.status).toBe(400);
  });

  it("cliPublishHttp returns 200 on success", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({ userId: "user1" } as never);
    vi.mocked(publishVersionForUser).mockResolvedValueOnce({
      skillId: "s",
      versionId: "v",
      embeddingId: "e",
    } as never);
    const request = new Request("https://x/api/cli/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "cool-skill",
        displayName: "Cool Skill",
        ownerHandle: "me",
        version: "1.2.3",
        changelog: "c",
        acceptLicenseTerms: true,
        forkOf: { slug: "upstream", ownerHandle: "@openclaw", version: "1.0.0" },
        files: [{ path: "SKILL.md", size: 1, storageId: "id", sha256: "a" }],
      }),
    });
    const response = await __handlers.cliPublishHandler(
      makeCtx({ runMutation: vi.fn().mockResolvedValue({ publisherId: "publishers:me" }) }),
      request,
    );
    if (response.status !== 200) throw new Error(await response.text());
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.skillId).toBe("s");
    expect(publishVersionForUser).toHaveBeenCalledWith(
      expect.anything(),
      "user1",
      expect.objectContaining({
        forkOf: { slug: "upstream", ownerHandle: "openclaw", version: "1.0.0" },
      }),
      expect.anything(),
    );
  });

  it("cliPublishHttp defaults omitted ownerHandle to personal publish scope", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({ userId: "user1" } as never);
    vi.mocked(publishVersionForUser).mockResolvedValueOnce({
      skillId: "s",
      versionId: "v",
      embeddingId: "e",
    } as never);
    const runMutation = vi.fn();
    const request = new Request("https://x/api/cli/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "cool-skill",
        displayName: "Cool Skill",
        version: "1.2.3",
        changelog: "c",
        acceptLicenseTerms: true,
        migrateOwner: true,
        sourceOwnerHandle: "org",
        files: [{ path: "SKILL.md", size: 1, storageId: "id", sha256: "a" }],
      }),
    });
    const response = await __handlers.cliPublishHandler(makeCtx({ runMutation }), request);
    if (response.status !== 200) throw new Error(await response.text());
    expect(response.status).toBe(200);
    expect(runMutation).not.toHaveBeenCalled();
    expect(publishVersionForUser).toHaveBeenCalledWith(
      expect.anything(),
      "user1",
      expect.not.objectContaining({ ownerHandle: expect.anything() }),
      expect.not.objectContaining({ ownerPublisherId: expect.anything() }),
    );
    expect(vi.mocked(publishVersionForUser).mock.calls[0]?.[3]).not.toHaveProperty(
      "ownerPublisherId",
    );
    expect(vi.mocked(publishVersionForUser).mock.calls[0]?.[3]).not.toHaveProperty(
      "sourceOwnerPublisherId",
    );
    expect(vi.mocked(publishVersionForUser).mock.calls[0]?.[3]).not.toHaveProperty("migrateOwner");
  });

  it("cliPublishHttp treats same source and target owner as a normal owner-scoped publish", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({ userId: "user1" } as never);
    vi.mocked(publishVersionForUser).mockResolvedValueOnce({
      skillId: "s",
      versionId: "v",
      embeddingId: "e",
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (args.ownerHandle === "openclaw") return { publisherId: "publishers:openclaw" };
      return null;
    });
    const request = new Request("https://x/api/cli/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "cool-skill",
        displayName: "Cool Skill",
        ownerHandle: "openclaw",
        sourceOwnerHandle: "openclaw",
        migrateOwner: true,
        version: "1.2.3",
        changelog: "c",
        acceptLicenseTerms: true,
        files: [{ path: "SKILL.md", size: 1, storageId: "id", sha256: "a" }],
      }),
    });
    const response = await __handlers.cliPublishHandler(makeCtx({ runMutation }), request);
    if (response.status !== 200) throw new Error(await response.text());
    expect(response.status).toBe(200);
    expect(publishVersionForUser).toHaveBeenCalledWith(
      expect.anything(),
      "user1",
      expect.not.objectContaining({ ownerHandle: expect.anything() }),
      { ownerPublisherId: "publishers:openclaw" },
    );
  });

  it("cliPublishHttp rejects omitted license terms", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({ userId: "user1" } as never);
    const request = new Request("https://x/api/cli/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "cool-skill",
        displayName: "Cool Skill",
        ownerHandle: "me",
        version: "1.2.3",
        changelog: "c",
        files: [{ path: "SKILL.md", size: 1, storageId: "id", sha256: "a" }],
      }),
    });
    const response = await __handlers.cliPublishHandler(makeCtx({}), request);
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/license terms must be accepted/i);
    expect(publishVersionForUser).not.toHaveBeenCalled();
  });

  it("cliPublishHttp rejects explicit license refusal", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({ userId: "user1" } as never);
    const request = new Request("https://x/api/cli/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "cool-skill",
        displayName: "Cool Skill",
        ownerHandle: "me",
        version: "1.2.3",
        changelog: "c",
        acceptLicenseTerms: false,
        files: [{ path: "SKILL.md", size: 1, storageId: "id", sha256: "a" }],
      }),
    });
    const response = await __handlers.cliPublishHandler(makeCtx({}), request);
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/license terms must be accepted/i);
  });

  it("cliSkillDeleteHandler returns 401 when unauthorized", async () => {
    vi.mocked(requireApiTokenUser).mockRejectedValueOnce(new Error("Unauthorized"));
    const request = new Request("https://x/api/cli/skill/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "demo" }),
    });
    const response = await __handlers.cliSkillDeleteHandler(makeCtx({}), request, true);
    expect(response.status).toBe(401);
  });

  it("cliSkillDeleteHandler calls mutation and returns ok", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({ userId: "user1" } as never);
    const runMutation = vi.fn().mockResolvedValue({ ok: true });
    const request = new Request("https://x/api/cli/skill/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "demo" }),
    });
    const response = await __handlers.cliSkillDeleteHandler(
      makeCtx({ runMutation }),
      request,
      true,
    );
    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      userId: "user1",
      slug: "demo",
      deleted: true,
    });
    expect(await response.json()).toEqual({ ok: true });
  });

  it("cliSkillDeleteHandler supports undelete", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({ userId: "user1" } as never);
    const runMutation = vi.fn().mockResolvedValue({ ok: true });
    const request = new Request("https://x/api/cli/skill/undelete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "demo" }),
    });
    const response = await __handlers.cliSkillDeleteHandler(
      makeCtx({ runMutation }),
      request,
      false,
    );
    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      userId: "user1",
      slug: "demo",
      deleted: false,
    });
  });

  it("cliSkillUndeleteHttp calls delete handler with deleted=false", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({ userId: "user1" } as never);
    const runMutation = vi.fn().mockResolvedValue({ ok: true });
    const response = await __handlers.cliSkillDeleteHandler(
      makeCtx({ runMutation }),
      new Request("https://x/api/cli/skill/undelete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "demo" }),
      }),
      false,
    );
    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      userId: "user1",
      slug: "demo",
      deleted: false,
    });
    warnSpy.mockRestore();
  });

  it("cliSkillDeleteHttp calls delete handler with deleted=true", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({ userId: "user1" } as never);
    const runMutation = vi.fn().mockResolvedValue({ ok: true });
    const response = await __handlers.cliSkillDeleteHandler(
      makeCtx({ runMutation }),
      new Request("https://x/api/cli/skill/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "demo" }),
      }),
      true,
    );
    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      userId: "user1",
      slug: "demo",
      deleted: true,
    });
    warnSpy.mockRestore();
  });

  it("cliSkillDeleteHandler returns 400 on invalid json", async () => {
    const request = new Request("https://x/api/cli/skill/delete", { method: "POST", body: "{" });
    const response = await __handlers.cliSkillDeleteHandler(makeCtx({}), request, true);
    expect(response.status).toBe(400);
  });

  it("cliSkillDeleteHandler returns 400 on invalid payload", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({ userId: "user1" } as never);
    const request = new Request("https://x/api/cli/skill/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const response = await __handlers.cliSkillDeleteHandler(makeCtx({}), request, true);
    expect(response.status).toBe(400);
  });
});
