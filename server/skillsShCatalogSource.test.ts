/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import {
  captureSkillsShCatalogTestSnapshot,
  fetchSkillsShCatalogDetail,
  fetchSkillsShCatalogPage,
  fetchSkillsShCatalogTestPage,
  getSkillsShCatalogTestSourcePolicy,
  SkillsShCatalogOwnerProofRequiredError,
  validateSkillsShCatalogGitHubOwnerProof,
} from "./skillsShCatalogSource";

describe("skills.sh Vercel source boundary", () => {
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
          fetches: 2,
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
        fetches: 1,
        owners: [{ owner: "nvidia", login: "nvidia", id: 1_728_152 }],
      }),
    ).toThrow("lacks complete authenticated GitHub owner proof");
    expect(() =>
      validateSkillsShCatalogGitHubOwnerProof(["nvidia"], {
        authentication: "clawhub-github-authenticated",
        fetches: 1,
        owners: [{ owner: "nvidia", login: "renamed-owner", id: 1_728_152 }],
      }),
    ).toThrow("invalid authenticated GitHub owner proof");
  });

  it("preflights exact live owners before fetching 500 canonical details", async () => {
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
        environment: "preview",
        sub: "owner:project:preview",
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

    const preflight = await captureSkillsShCatalogTestSnapshot(options).catch((error) => error);
    expect(preflight).toBeInstanceOf(SkillsShCatalogOwnerProofRequiredError);
    expect(preflight).toMatchObject({
      owners: ["anthropics", "nvidia", "owner"],
      sourcePreflight: {
        skillsShFetches: 2,
        listFetches: 1,
        searchFetches: 1,
        detailFetches: 0,
        selection: {
          rows: 500,
          nvidiaRows: 10,
        },
      },
    });
    expect(detailUrls).toHaveLength(0);

    const snapshot = await captureSkillsShCatalogTestSnapshot({
      ...options,
      githubOwnerProof: {
        authentication: "clawhub-github-authenticated",
        fetches: 3,
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
    });
    expect(snapshot.artifacts).toHaveLength(1);
    expect(snapshot.metrics).toMatchObject({
      skillsShFetches: 502,
      listFetches: 1,
      searchFetches: 1,
      detailFetches: 500,
      githubOwnerFetches: 3,
    });
    expect(detailUrls).toHaveLength(500);
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
        environment: "preview",
        sub: "owner:project:preview",
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
      environment: "preview",
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
