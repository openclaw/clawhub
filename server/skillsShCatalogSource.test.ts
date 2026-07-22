/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import {
  buildSkillsShMirrorObservation,
  buildSkillsShMirrorDetail,
  buildSkillsShMirrorUpstreamScanners,
  captureSkillsShCatalogTestSnapshot,
  fetchSkillsShCatalogDetail,
  fetchSkillsShMirrorBatch,
  fetchSkillsShCatalogPage,
  fetchSkillsShCatalogTestPage,
  getSkillsShCatalogTestSourcePolicy,
  SkillsShCatalogOwnerProofRequiredError,
  validateSkillsShCatalogGitHubOwnerProof,
} from "./skillsShCatalogSource";

describe("skills.sh Vercel source boundary", () => {
  it("retains each upstream scanner status and source link independently", () => {
    expect(
      buildSkillsShMirrorUpstreamScanners(
        `
          <a href="/vercel-labs/skills/find-skills/security/agent-trust-hub">
            <span>Gen Agent Trust Hub</span><span>Pass</span>
          </a>
          <a href="/vercel-labs/skills/find-skills/security/socket">
            <span>Socket</span><span>Pass</span>
          </a>
          <a href="/vercel-labs/skills/find-skills/security/snyk">
            <span>Snyk</span><span>Warn</span>
          </a>
        `,
        "https://skills.sh/vercel-labs/skills/find-skills",
      ),
    ).toEqual({
      genAgentTrustHub: {
        status: "pass",
        sourceUrl: "https://skills.sh/vercel-labs/skills/find-skills/security/agent-trust-hub",
      },
      socket: {
        status: "pass",
        sourceUrl: "https://skills.sh/vercel-labs/skills/find-skills/security/socket",
      },
      snyk: {
        status: "warn",
        sourceUrl: "https://skills.sh/vercel-labs/skills/find-skills/security/snyk",
      },
    });

    expect(
      buildSkillsShMirrorUpstreamScanners(
        "<html><body>No audit links</body></html>",
        "https://skills.sh/open.feishu.cn/lark-doc",
      ),
    ).toEqual({
      genAgentTrustHub: { status: "unavailable" },
      socket: { status: "unavailable" },
      snyk: { status: "unavailable" },
    });
  });

  it("normalizes GitHub and well-known rows without inventing repository identity", () => {
    expect(
      buildSkillsShMirrorObservation({
        id: "Vercel-Labs/Skills/Find-Skills",
        installUrl: "https://github.com/vercel-labs/skills",
        installs: 42,
        name: "Find Skills",
        slug: "Find-Skills",
        source: "Vercel-Labs/Skills",
        sourceType: "github",
        url: "https://skills.sh/vercel-labs/skills/find-skills",
      }),
    ).toMatchObject({
      externalId: "vercel-labs/skills/find-skills",
      sourceType: "github",
      owner: "vercel-labs",
      repo: "skills",
      slug: "find-skills",
      canonicalRepoUrl: "https://github.com/vercel-labs/skills",
      upstreamInstalls: 42,
    });

    expect(
      buildSkillsShMirrorObservation({
        id: "open.feishu.cn/lark-doc",
        installUrl: null,
        installs: 7,
        name: "lark-doc",
        slug: "lark-doc",
        source: "open.feishu.cn",
        sourceType: "well-known",
        url: "https://www.skills.sh/site/open.feishu.cn/lark-doc",
      }),
    ).toMatchObject({
      externalId: "open.feishu.cn/lark-doc",
      sourceType: "well-known",
      sourceHost: "open.feishu.cn",
      slug: "lark-doc",
      upstreamInstalls: 7,
    });
  });

  it("stores only one bounded detail document from the upstream file tree", () => {
    const detail = buildSkillsShMirrorDetail(
      {
        id: "vercel-labs/skills/find-skills",
        source: "vercel-labs/skills",
        slug: "find-skills",
        installs: 42,
        hash: "a".repeat(64),
        files: [
          { path: "references/notes.md", contents: "do not retain" },
          { path: "README.md", contents: "readme" },
          { path: "SKILL.md", contents: "1234567890" },
        ],
      },
      8,
    );

    expect(detail).toEqual({
      sourceContentHash: "a".repeat(64),
      sourceFileCount: 3,
      contentKind: "skill-md",
      path: "SKILL.md",
      content: "12345678",
      contentBytes: 8,
      sourceBytes: 10,
      truncated: true,
    });
  });

  it("fetches one bounded mirror batch from an exact source page and offset", async () => {
    const fetchImpl = vi.fn(async (urlInput: string | URL | Request) => {
      const url = String(urlInput);
      if (url.includes("?page=3&per_page=500")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "vercel-labs/skills/find-skills",
                installUrl: "https://github.com/vercel-labs/skills",
                installs: 42,
                name: "Find Skills",
                slug: "find-skills",
                source: "vercel-labs/skills",
                sourceType: "github",
                url: "https://skills.sh/vercel-labs/skills/find-skills",
              },
              {
                id: "open.feishu.cn/lark-doc",
                installUrl: null,
                installs: 7,
                name: "lark-doc",
                slug: "lark-doc",
                source: "open.feishu.cn",
                sourceType: "well-known",
                url: "https://www.skills.sh/site/open.feishu.cn/lark-doc",
              },
            ],
            pagination: { page: 3, perPage: 500, total: 1_002, hasMore: false },
          }),
        );
      }
      if (!url.includes("/api/v1/skills/")) {
        return new Response(`
          <a href="/open.feishu.cn/lark-doc/security/socket">
            <span>Socket</span><span>Pass</span>
          </a>
        `);
      }
      const id = decodeURIComponent(url.split("/api/v1/skills/")[1] ?? "");
      return new Response(
        JSON.stringify({
          id,
          source: id.split("/").slice(0, -1).join("/"),
          slug: id.split("/").at(-1),
          installs: 1,
          hash: "a".repeat(64),
          files: [{ path: "SKILL.md", contents: `# ${id}` }],
        }),
      );
    });

    const batch = await fetchSkillsShMirrorBatch(
      { page: 3, offset: 1, limit: 1, maxDetailBytes: 64 },
      {
        env: { VERCEL_OIDC_TOKEN: "request-token" },
        fetchImpl: fetchImpl as typeof fetch,
      },
    );

    expect(batch).toMatchObject({
      page: 3,
      offset: 1,
      pageLength: 2,
      sourceTotal: 1_002,
      hasMore: false,
      rows: [
        {
          externalId: "open.feishu.cn/lark-doc",
          sourceType: "well-known",
          sourceHost: "open.feishu.cn",
          sourceContentHash: "a".repeat(64),
          upstreamScanners: {
            genAgentTrustHub: { status: "unavailable" },
            socket: {
              status: "pass",
              sourceUrl: "https://www.skills.sh/open.feishu.cn/lark-doc/security/socket",
            },
            snyk: { status: "unavailable" },
          },
          detail: { contentKind: "skill-md", path: "SKILL.md" },
        },
      ],
      sourceRequests: 3,
    });
  });

  it("uses only the injected Vercel OIDC token for source authentication", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [],
          pagination: { page: 0, perPage: 500, total: 0, hasMore: false },
        }),
      );
    });

    await fetchSkillsShCatalogPage(
      { page: 0, perPage: 500 },
      {
        env: { VERCEL_OIDC_TOKEN: "short-lived-vercel-oidc" },
        fetchImpl,
      },
    );

    expect(fetchImpl).toHaveBeenCalledWith("https://skills.sh/api/v1/skills?page=0&per_page=500", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer short-lived-vercel-oidc",
      },
    });
  });

  it("accepts a request-bound OIDC token without requiring an environment copy", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [],
          pagination: { page: 0, perPage: 500, total: 0, hasMore: false },
        }),
      );
    });

    await fetchSkillsShCatalogPage(
      { page: 0, perPage: 500 },
      {
        env: {},
        oidcToken: "request-bound-oidc",
        fetchImpl,
      },
    );

    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), {
      headers: expect.objectContaining({
        Authorization: "Bearer request-bound-oidc",
      }),
    });
  });

  it("retries transient source responses and counts every request", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async (urlInput: string | URL | Request) => {
      attempts += 1;
      if (attempts === 1) {
        return new Response("busy", {
          status: 503,
          headers: { "retry-after": "0" },
        });
      }
      const url = String(urlInput);
      if (url.includes("?page=0&per_page=500")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "vercel-labs/skills/find-skills",
                installUrl: "https://github.com/vercel-labs/skills",
                installs: 42,
                name: "Find Skills",
                slug: "find-skills",
                source: "vercel-labs/skills",
                sourceType: "github",
                url: "https://skills.sh/vercel-labs/skills/find-skills",
              },
            ],
            pagination: { page: 0, perPage: 500, total: 1, hasMore: false },
          }),
        );
      }
      if (!url.includes("/api/v1/skills/")) {
        return new Response("<html><body>No audit links</body></html>");
      }
      return new Response(
        JSON.stringify({
          id: "vercel-labs/skills/find-skills",
          source: "vercel-labs/skills",
          slug: "find-skills",
          installs: 42,
          hash: "a".repeat(64),
          files: [{ path: "SKILL.md", contents: "# Find Skills" }],
        }),
      );
    });

    const batch = await fetchSkillsShMirrorBatch(
      { page: 0, offset: 0, limit: 1, maxDetailBytes: 64 },
      { oidcToken: "request-bound-oidc", fetchImpl: fetchImpl as typeof fetch },
    );

    expect(batch.sourceRequests).toBe(4);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("fails closed without OIDC and above the 500-row boundary", async () => {
    await expect(
      fetchSkillsShCatalogPage({ page: 0, perPage: 500 }, { env: {}, fetchImpl: vi.fn() }),
    ).rejects.toThrow("requires VERCEL_OIDC_TOKEN");
    await expect(
      fetchSkillsShCatalogPage(
        { page: 0, perPage: 501 },
        { env: { VERCEL_OIDC_TOKEN: "token" }, fetchImpl: vi.fn() },
      ),
    ).rejects.toThrow("perPage must be an integer between 1 and 500");
  });

  it("preserves repository-qualified detail ids", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          id: "anthropics/claude-code/frontend-design",
          source: "anthropics/claude-code",
          slug: "frontend-design",
          installs: 1,
          hash: "hash",
          files: [],
        }),
      );
    });

    await fetchSkillsShCatalogDetail("anthropics/claude-code/frontend-design", {
      env: { VERCEL_OIDC_TOKEN: "token" },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://skills.sh/api/v1/skills/anthropics/claude-code/frontend-design",
      expect.any(Object),
    );
  });

  it("requires the Test build, Preview runtime, baked backend, and explicit enable", () => {
    expect(
      getSkillsShCatalogTestSourcePolicy({
        VERCEL_ENV: "preview",
        CLAWHUB_SKILLS_SH_TEST_LIVE_FETCH_ENABLED: "1",
      }),
    ).toMatchObject({ allowed: false });

    expect(
      getSkillsShCatalogTestSourcePolicy({
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "test",
        VITE_CLAWHUB_DEPLOY_ENV: "test",
        VITE_CONVEX_URL: "https://academic-chihuahua-392.convex.cloud",
        CLAWHUB_SKILLS_SH_TEST_LIVE_FETCH_ENABLED: "1",
      }),
    ).toEqual({
      allowed: true,
      environment: "test",
      maxDiscoveryRows: 500,
      maxRealScanAdmissions: 10,
    });
  });

  it("requires exact authenticated immutable owner coverage for the selected live set", () => {
    expect(
      Array.from(
        validateSkillsShCatalogGitHubOwnerProof(["anthropics", "nvidia"], {
          authentication: "clawhub-github-authenticated",
          provenance: "live-github",
          fetches: 2,
          reused: 0,
          owners: [
            { owner: "anthropics", login: "anthropics", id: 76_263_028 },
            { owner: "nvidia", login: "nvidia", id: 1_728_152 },
          ],
        }),
      ),
    ).toEqual([
      ["anthropics", 76_263_028],
      ["nvidia", 1_728_152],
    ]);

    expect(() =>
      validateSkillsShCatalogGitHubOwnerProof(["anthropics", "nvidia"], {
        authentication: "clawhub-github-authenticated",
        provenance: "live-github",
        fetches: 1,
        reused: 0,
        owners: [{ owner: "nvidia", login: "nvidia", id: 1_728_152 }],
      }),
    ).toThrow("lacks complete authenticated GitHub owner proof");
    expect(() =>
      validateSkillsShCatalogGitHubOwnerProof(["nvidia"], {
        authentication: "clawhub-github-authenticated",
        provenance: "stored-authenticated-staging-live",
        fetches: 0,
        reused: 1,
        owners: [{ owner: "nvidia", login: "renamed-owner", id: 1_728_152 }],
      }),
    ).toThrow("invalid authenticated GitHub owner proof");
  });

  it("selects 500 hash-qualified rows before requiring exact live owner proofs", async () => {
    const listRows = [
      {
        id: "anthropics/skills/frontend-design",
        installUrl: "https://github.com/anthropics/skills",
        installs: 100,
        name: "Frontend Design",
        slug: "frontend-design",
        source: "anthropics/skills",
        sourceType: "github",
        url: "https://skills.sh/anthropics/skills/frontend-design",
      },
      {
        id: "anthropics/claude-code/frontend-design",
        installUrl: "https://github.com/anthropics/claude-code",
        installs: 99,
        name: "Frontend Design",
        slug: "frontend-design",
        source: "anthropics/claude-code",
        sourceType: "github",
        url: "https://skills.sh/anthropics/claude-code/frontend-design",
      },
      ...Array.from({ length: 498 }, (_, index) => ({
        id: `owner/repo-${index}/skill-${index}`,
        installUrl: `https://github.com/owner/repo-${index}`,
        installs: index,
        name: `Skill ${index}`,
        slug: `skill-${index}`,
        source: `owner/repo-${index}`,
        sourceType: "github",
        url: `https://skills.sh/owner/repo-${index}/skill-${index}`,
      })),
    ];
    const nvidiaRows = Array.from({ length: 10 }, (_, index) => ({
      id: `nvidia/skills/nvidia-skill-${index}`,
      installUrl: "https://github.com/nvidia/skills",
      installs: 1_000 - index,
      name: `NVIDIA Skill ${index}`,
      slug: `nvidia-skill-${index}`,
      source: "nvidia/skills",
      sourceType: "github",
      url: `https://skills.sh/nvidia/skills/nvidia-skill-${index}`,
    }));
    const detailUrls: string[] = [];
    const fetchImpl = vi.fn(async (urlInput: string | URL | Request) => {
      const url = String(urlInput);
      if (url.includes("/skills?")) {
        return new Response(
          JSON.stringify({
            data: listRows,
            pagination: {
              page: 0,
              perPage: 500,
              total: 500,
              hasMore: false,
            },
          }),
        );
      }
      if (url.includes("/skills/search?")) {
        return new Response(JSON.stringify({ data: nvidiaRows }));
      }
      detailUrls.push(url);
      const id = decodeURIComponent(url.split("/api/v1/skills/")[1] ?? "");
      if (id === "owner/repo-0/skill-0") {
        return new Response(
          JSON.stringify({
            id,
            source: "owner/repo-0",
            slug: "skill-0",
            installs: 1,
            hash: null,
            files: null,
          }),
        );
      }
      if (id === "owner/repo-1/skill-1") {
        return new Response(
          JSON.stringify({
            id,
            source: "owner/repo-1",
            slug: "skill-1",
            installs: 1,
            hash: "b".repeat(64),
            files: null,
          }),
        );
      }
      if (id === "owner/repo-2/skill-2") {
        return new Response(
          JSON.stringify({
            id,
            source: "owner/repo-2",
            slug: "skill-2",
            installs: 1,
            hash: "c".repeat(64),
            files: [{ name: "SKILL.md" }],
          }),
        );
      }
      return new Response(
        JSON.stringify({
          id,
          source: id.split("/").slice(0, 2).join("/"),
          slug: id.split("/").at(-1),
          installs: 1,
          hash: "a".repeat(64),
          files: [{ name: "SKILL.md", content: `# ${id}` }],
        }),
      );
    });
    const readOidc = async () => "oidc";
    const verifyOidc = async () => ({
      payload: {
        owner_id: "team_pLdjXbfy0XvPRiNmAygTjTSH",
        project_id: "prj_UVAJPNPYrBwTEkPJwkpEySsge8Mc",
        environment: "test",
        sub: "owner:project:test",
        aud: "https://vercel.com",
        iss: "https://oidc.vercel.com",
      },
    });
    const options = {
      env: {
        VERCEL_ENV: "preview",
        VITE_CLAWHUB_DEPLOY_ENV: "test",
        VITE_CONVEX_URL: "https://academic-chihuahua-392.convex.cloud",
        CLAWHUB_SKILLS_SH_TEST_LIVE_FETCH_ENABLED: "1",
      },
      fetchImpl: fetchImpl as typeof fetch,
      getOidcToken: readOidc,
      verifyOidcToken: verifyOidc,
      readConvexControl: async () => ({
        mode: "staging-live" as const,
        discoveryEnabled: true,
        writesEnabled: true,
        scanPlanningEnabled: true,
        maxEntriesPerRun: 500,
        publicVisibilityEnabled: false,
      }),
      admitExternalIds: ["nvidia/skills/nvidia-skill-0"],
    };

    await expect(
      captureSkillsShCatalogTestSnapshot({
        ...options,
        admitExternalIds: ["owner/repo-1/skill-1"],
      }),
    ).rejects.toThrow("live admission lacks artifact files");
    detailUrls.length = 0;

    await expect(
      captureSkillsShCatalogTestSnapshot({
        ...options,
        admitExternalIds: ["owner/repo-2/skill-2"],
      }),
    ).rejects.toThrow("live admission has incomplete artifact files");
    detailUrls.length = 0;

    const preflight = await captureSkillsShCatalogTestSnapshot(options).catch((error) => error);
    expect(preflight).toBeInstanceOf(SkillsShCatalogOwnerProofRequiredError);
    expect(preflight).toMatchObject({
      owners: ["anthropics", "nvidia", "owner"],
      sourcePreflight: {
        skillsShFetches: 506,
        listFetches: 1,
        searchFetches: 1,
        detailFetches: 504,
        selection: {
          rows: 500,
          nvidiaRows: 10,
          skippedIncompleteDetails: 1,
        },
      },
    });
    expect(detailUrls).toHaveLength(504);

    detailUrls.length = 0;
    const snapshot = await captureSkillsShCatalogTestSnapshot({
      ...options,
      githubOwnerProof: {
        authentication: "clawhub-github-authenticated",
        provenance: "stored-authenticated-staging-live",
        fetches: 0,
        reused: 3,
        owners: [
          { owner: "anthropics", login: "anthropics", id: 76_263_028 },
          { owner: "nvidia", login: "nvidia", id: 1_728_152 },
          { owner: "owner", login: "owner", id: 123 },
        ],
      },
    });
    expect(snapshot.rows).toHaveLength(500);
    expect(snapshot.selection).toMatchObject({
      rows: 500,
      nvidiaRows: 10,
      requiredCollisionIds: [
        "anthropics/skills/frontend-design",
        "anthropics/claude-code/frontend-design",
      ],
      skippedIncompleteDetails: 1,
    });
    expect(snapshot.rows.some((row) => row.externalId === "owner/repo-0/skill-0")).toBe(false);
    expect(snapshot.artifacts).toHaveLength(1);
    expect(snapshot.metrics).toMatchObject({
      skillsShFetches: 506,
      listFetches: 1,
      searchFetches: 1,
      detailFetches: 504,
      githubOwnerFetches: 0,
      githubOwnerIdsReused: 3,
      githubOwnerProofProvenance: "stored-authenticated-staging-live",
      skippedIncompleteDetails: 1,
    });
    expect(detailUrls).toHaveLength(504);
  });

  it("rejects an ordinary Preview even when spoofable Test strings are present", async () => {
    await expect(
      fetchSkillsShCatalogTestPage({
        env: {
          VERCEL_ENV: "preview",
          VERCEL_TARGET_ENV: "test",
          VITE_CLAWHUB_DEPLOY_ENV: "test",
          VITE_CONVEX_URL: "https://academic-chihuahua-392.convex.cloud",
          CLAWHUB_SKILLS_SH_TEST_LIVE_FETCH_ENABLED: "1",
        },
        getOidcToken: async () => "ordinary-preview-token",
        verifyOidcToken: async () => {
          throw new Error("unexpected Vercel project");
        },
        readConvexControl: async () => ({
          mode: "staging-live",
          discoveryEnabled: true,
          writesEnabled: true,
          scanPlanningEnabled: true,
          maxEntriesPerRun: 500,
          publicVisibilityEnabled: false,
        }),
      }),
    ).rejects.toThrow("unexpected Vercel project");
  });

  it("rejects a verified ClawHub Preview token without the custom Test environment claim", async () => {
    await expect(
      fetchSkillsShCatalogTestPage({
        env: {
          VERCEL_ENV: "preview",
          VERCEL_TARGET_ENV: "test",
          VITE_CLAWHUB_DEPLOY_ENV: "test",
          VITE_CONVEX_URL: "https://academic-chihuahua-392.convex.cloud",
          CLAWHUB_SKILLS_SH_TEST_LIVE_FETCH_ENABLED: "1",
        },
        getOidcToken: async () => "ordinary-preview-token",
        verifyOidcToken: async () => ({
          payload: {
            owner_id: "team_pLdjXbfy0XvPRiNmAygTjTSH",
            project_id: "prj_UVAJPNPYrBwTEkPJwkpEySsge8Mc",
            environment: "preview",
            sub: "owner:project:preview",
            aud: "https://vercel.com",
            iss: "https://oidc.vercel.com",
          },
        }),
        readConvexControl: async () => ({
          mode: "staging-live",
          discoveryEnabled: true,
          writesEnabled: true,
          scanPlanningEnabled: true,
          maxEntriesPerRun: 500,
          publicVisibilityEnabled: false,
        }),
      }),
    ).rejects.toThrow("verified ClawHub Vercel identity");
  });

  it("fetches through the verified request token only when the dark Convex control allows it", async () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({
      id: `owner/repo/skill-${index}`,
      installUrl: null,
      installs: index,
      name: `Skill ${index}`,
      slug: `skill-${index}`,
      source: "owner/repo",
      sourceType: "github",
      url: `https://skills.sh/owner/repo/skill-${index}`,
    }));
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: rows,
          pagination: {
            page: 0,
            perPage: 500,
            total: 500,
            hasMore: false,
          },
        }),
      );
    });
    const env = {
      VERCEL_ENV: "preview",
      VITE_CLAWHUB_DEPLOY_ENV: "test",
      VITE_CONVEX_URL: "https://academic-chihuahua-392.convex.cloud",
      CLAWHUB_SKILLS_SH_TEST_LIVE_FETCH_ENABLED: "1",
    };
    const getOidcToken = vi.fn(async () => "request-token");
    const verifyOidcToken = vi.fn(async () => ({
      payload: {
        owner_id: "team_pLdjXbfy0XvPRiNmAygTjTSH",
        project_id: "prj_UVAJPNPYrBwTEkPJwkpEySsge8Mc",
        environment: "test",
        sub: "owner:project:test",
        aud: "https://vercel.com",
        iss: "https://oidc.vercel.com",
      },
    }));

    const result = await fetchSkillsShCatalogTestPage({
      env,
      fetchImpl,
      getOidcToken,
      verifyOidcToken,
      readConvexControl: async () => ({
        mode: "staging-live",
        discoveryEnabled: true,
        writesEnabled: true,
        scanPlanningEnabled: true,
        maxEntriesPerRun: 500,
        publicVisibilityEnabled: false,
      }),
    });

    expect(result.page.data).toHaveLength(500);
    expect(getOidcToken).toHaveBeenCalledOnce();
    expect(verifyOidcToken).toHaveBeenCalledWith("request-token", {
      projectId: "prj_UVAJPNPYrBwTEkPJwkpEySsge8Mc",
      ownerId: "team_pLdjXbfy0XvPRiNmAygTjTSH",
      environment: "test",
    });
    expect(result.controls).toEqual({
      maxDiscoveryRows: 500,
      maxRealScanAdmissions: 10,
      publicVisibilityEnabled: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://skills.sh/api/v1/skills?page=0&per_page=500",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer request-token",
        }),
      }),
    );

    await expect(
      fetchSkillsShCatalogTestPage({
        env,
        fetchImpl,
        getOidcToken: async () => "request-token",
        verifyOidcToken,
        readConvexControl: async () => ({
          mode: "fixture",
          discoveryEnabled: true,
          writesEnabled: true,
          scanPlanningEnabled: true,
          maxEntriesPerRun: 500,
          publicVisibilityEnabled: false,
        }),
      }),
    ).rejects.toThrow("dark Convex staging control");
  });
});
