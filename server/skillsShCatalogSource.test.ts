/* @vitest-environment node */

import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSkillsShMirrorProofSnapshotId,
  buildSkillsShMirrorObservation,
  buildSkillsShMirrorControlledObservation,
  buildSkillsShMirrorDetail,
  buildSkillsShMirrorUpstreamScanners,
  captureSkillsShCatalogTestSnapshot,
  fetchSkillsShCatalogDetail,
  fetchSkillsShMirrorBatch,
  fetchSkillsShMirrorControlledBatch,
  fetchSkillsShCatalogPage,
  fetchSkillsShCatalogTestPage,
  getSkillsShCatalogTestSourcePolicy,
  measureSkillsShMirrorProofSource,
  parseSkillsShMirrorProofSnapshotId,
  resolveSkillsShMirrorGitHubLocators,
  skillsShSourceRetryAfterSeconds,
  SkillsShCatalogOwnerProofRequiredError,
  validateSkillsShCatalogGitHubOwnerProof,
} from "./skillsShCatalogSource";

describe("skills.sh Vercel source boundary", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retains each upstream scanner status and source link independently", () => {
    expect(
      buildSkillsShMirrorUpstreamScanners(
        {
          id: "vercel-labs/skills/find-skills",
          source: "vercel-labs/skills",
          slug: "find-skills",
          audits: [
            {
              provider: "Runlayer",
              slug: "runlayer",
              status: "pass",
              auditedAt: "2026-07-22T20:00:00.000Z",
            },
            {
              provider: "Gen Agent Trust Hub",
              slug: "agent-trust-hub",
              status: "pass",
              auditedAt: "2026-07-22T20:01:00.000Z",
            },
            {
              provider: "Socket",
              slug: "socket",
              status: "pass",
              auditedAt: "2026-07-22T20:02:00.000Z",
            },
            {
              provider: "Snyk",
              slug: "snyk",
              status: "warn",
              auditedAt: "2026-07-22T20:03:00.000Z",
            },
            {
              provider: "ZeroLeaks",
              slug: "zeroleaks",
              status: "fail",
              auditedAt: "2026-07-22T20:04:00.000Z",
            },
          ],
        },
        "https://skills.sh/vercel-labs/skills/find-skills",
      ),
    ).toEqual({
      genAgentTrustHub: {
        status: "pass",
        sourceUrl: "https://skills.sh/vercel-labs/skills/find-skills/security/agent-trust-hub",
        sourceCheckedAt: "2026-07-22T20:01:00.000Z",
      },
      socket: {
        status: "pass",
        sourceUrl: "https://skills.sh/vercel-labs/skills/find-skills/security/socket",
        sourceCheckedAt: "2026-07-22T20:02:00.000Z",
      },
      snyk: {
        status: "warn",
        sourceUrl: "https://skills.sh/vercel-labs/skills/find-skills/security/snyk",
        sourceCheckedAt: "2026-07-22T20:03:00.000Z",
      },
    });

    expect(
      buildSkillsShMirrorUpstreamScanners(null, "https://skills.sh/open.feishu.cn/lark-doc"),
    ).toEqual({
      genAgentTrustHub: { status: "unavailable" },
      socket: { status: "unavailable" },
      snyk: { status: "unavailable" },
    });
  });

  it("builds a hidden controlled observation only from exact immutable content", () => {
    const fullContent = "# Controlled\n\nThis content is longer than the retained prefix.";
    const supplement = {
      externalId: "owner/repo/controlled",
      owner: "owner",
      repo: "repo",
      slug: "controlled",
      displayName: "Controlled",
      sourceUrl: "https://www.skills.sh/owner/repo/controlled",
      githubPath: "skills/controlled",
      detailPath: "skills/controlled/SKILL.md",
      githubCommit: "0123456789abcdef0123456789abcdef01234567",
      sourceContentHash: createHash("sha256").update(fullContent).digest("hex"),
    };

    expect(
      buildSkillsShMirrorControlledObservation(
        supplement,
        fullContent,
        Buffer.byteLength(fullContent),
        16,
      ),
    ).toMatchObject({
      externalId: "owner/repo/controlled",
      sourceType: "github",
      upstreamSourceType: "controlled-github",
      canonicalRepoUrl: "https://github.com/owner/repo",
      githubPath: "skills/controlled",
      githubCommit: "0123456789abcdef0123456789abcdef01234567",
      sourceContentHash: supplement.sourceContentHash,
      upstreamInstalls: 0,
      upstreamScanners: {
        genAgentTrustHub: { status: "unavailable" },
        socket: { status: "unavailable" },
        snyk: { status: "unavailable" },
      },
      detail: {
        path: "skills/controlled/SKILL.md",
        contentBytes: 16,
        sourceBytes: Buffer.byteLength(fullContent),
        sourceFileCount: 1,
        truncated: true,
      },
    });
    expect(() =>
      buildSkillsShMirrorControlledObservation(
        { ...supplement, sourceContentHash: "0".repeat(64) },
        fullContent,
        Buffer.byteLength(fullContent),
        16,
      ),
    ).toThrow("controlled skills.sh mirror source hash changed");
  });

  it("delegates long controlled-source Retry-After waits to durable recovery", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "120" },
      });
    });

    const error = await fetchSkillsShMirrorControlledBatch(
      {
        page: 0,
        offset: 0,
        limit: 1,
        maxDetailBytes: 64,
        sourceTotal: 1,
        externalIds: ["patrick-erichsen/skills/html"],
      },
      { fetchImpl: fetchImpl as typeof fetch },
    ).catch((value: unknown) => value);

    expect(skillsShSourceRetryAfterSeconds(error)).toBe(120);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not sleep after the final controlled-source rate-limit attempt", async () => {
    vi.useFakeTimers();
    let canceledResponses = 0;
    const fetchImpl = vi.fn(async () => {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("rate limited"));
          },
          cancel() {
            canceledResponses += 1;
          },
        }),
        {
          status: 429,
          headers: { "retry-after": "1" },
        },
      );
    });
    let settled = false;
    const resultPromise = fetchSkillsShMirrorControlledBatch(
      {
        page: 0,
        offset: 0,
        limit: 1,
        maxDetailBytes: 64,
        sourceTotal: 1,
        externalIds: ["patrick-erichsen/skills/html"],
      },
      { fetchImpl: fetchImpl as typeof fetch },
    ).catch((value: unknown) => value);
    void resultPromise.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(canceledResponses).toBe(1);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(canceledResponses).toBe(4);
    expect(settled).toBe(true);
    expect(skillsShSourceRetryAfterSeconds(await resultPromise)).toBe(1);
  });

  it("supplements only controlled identities absent from the authenticated catalog", async () => {
    const controlledRow = {
      id: "patrick-erichsen/skills/html",
      installUrl: null,
      installs: 1,
      name: "HTML",
      slug: "html",
      source: "patrick-erichsen/skills",
      sourceType: "github",
      url: "https://www.skills.sh/patrick-erichsen/skills/html",
    };
    const pages = [
      {
        data: Array.from({ length: 500 }, (_, index) =>
          index === 0
            ? controlledRow
            : {
                id: `owner/repo/other-${index}`,
                installUrl: null,
                installs: 1,
                name: `Other ${index}`,
                slug: `other-${index}`,
                source: "owner/repo",
                sourceType: "github",
                url: `https://www.skills.sh/owner/repo/other-${index}`,
              },
        ),
        pagination: { page: 0, perPage: 500, total: 501, hasMore: true },
      },
      {
        data: [
          {
            id: "owner/repo/other",
            installUrl: null,
            installs: 1,
            name: "Other",
            slug: "other",
            source: "owner/repo",
            sourceType: "github",
            url: "https://www.skills.sh/owner/repo/other",
          },
        ],
        pagination: { page: 1, perPage: 500, total: 501, hasMore: false },
      },
      {
        data: [],
        pagination: { page: 2, perPage: 500, total: 501, hasMore: false },
      },
    ];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/v1/skills?page=")) {
        return new Response(JSON.stringify(pages.shift()));
      }
      if (url.includes("/api/v1/skills/search?")) {
        return new Response(
          JSON.stringify({
            count: 1,
            data: [controlledRow],
            durationMs: 3,
            query: "html",
            searchType: "full-text",
          }),
        );
      }
      if (url.endsWith("/api/v1/skills/patrick-erichsen/skills/html")) {
        return new Response(
          JSON.stringify({
            files: [{ contents: "# HTML", path: "skills/html/SKILL.md" }],
            hash: "a".repeat(64),
            id: controlledRow.id,
            installs: 1,
            slug: "html",
            source: "patrick-erichsen/skills",
          }),
        );
      }
      if (url.includes("?_rsc=")) {
        return new Response(
          '0:["$","div",null,{"children":"HTML","className":"skill"}]\n1:{"prompt":"use html"}\n',
          { headers: { "Content-Type": "text/x-component" } },
        );
      }
      if (url === controlledRow.url) {
        return new Response(
          '<!doctype html><script type="application/ld+json">' +
            '{"@context":"https://schema.org","@type":"SoftwareApplication",' +
            '"applicationCategory":"DeveloperApplication","name":"HTML"}' +
            "</script>",
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const measured = await measureSkillsShMirrorProofSource({
      oidcToken: "oidc-token",
      fetchImpl: fetchImpl as typeof fetch,
      minimumApiRequestIntervalMs: 0,
    });

    expect(measured).toMatchObject({
      catalogTotal: 501,
      controlledExternalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
      controlledOverlayExternalIds: ["patrick-erichsen/skills/html"],
      controlledSupplementExternalIds: ["steipete/clawdis/discrawl"],
      pageSize: 500,
      sourceRequests: 7,
      sourcePages: [
        {
          page: 0,
          sourceTotal: 501,
          pageLength: 500,
          hasMore: true,
        },
        {
          page: 1,
          sourceTotal: 501,
          pageLength: 1,
          hasMore: false,
        },
      ],
      evidence: {
        pagination: {
          endpointExhausted: true,
          databaseCoverage: "leaderboard-only",
          page0: { page: 0, perPage: 500, total: 501, hasMore: true },
          requestedPages: [
            { page: 0, count: 500, hasMore: true },
            { page: 1, count: 1, hasMore: false },
            { page: 2, count: 0, hasMore: false },
          ],
          finalNonemptyPage: {
            page: 1,
            count: 1,
            pagination: { page: 1, perPage: 500, total: 501, hasMore: false },
          },
          firstBeyondEndPage: {
            page: 2,
            count: 0,
            pagination: { page: 2, perPage: 500, total: 501, hasMore: false },
          },
          uniqueIds: 501,
          duplicateIds: 0,
        },
        fields: {
          sampledExternalId: "patrick-erichsen/skills/html",
          leaderboard: {
            topLevelKeys: ["data", "pagination"],
            paginationKeys: ["hasMore", "page", "perPage", "total"],
            rowKeys: [
              "id",
              "installUrl",
              "installs",
              "name",
              "slug",
              "source",
              "sourceType",
              "url",
            ],
            taxonomyFields: [],
          },
          search: {
            topLevelKeys: ["count", "data", "durationMs", "query", "searchType"],
            rowKeys: [
              "id",
              "installUrl",
              "installs",
              "name",
              "slug",
              "source",
              "sourceType",
              "url",
            ],
            taxonomyFields: [],
          },
          detail: {
            topLevelKeys: ["files", "hash", "id", "installs", "slug", "source"],
            fileKeys: ["contents", "path"],
            taxonomyFields: [],
          },
          page: {
            url: controlledRow.url,
            jsonLdDocuments: [
              {
                type: "SoftwareApplication",
                keys: ["@context", "@type", "applicationCategory", "name"],
              },
            ],
            taxonomyFields: [],
          },
          rsc: {
            objectKeys: ["children", "className", "prompt"],
            taxonomyFields: [],
          },
          normalizedUpstreamTaxonomyFields: [],
        },
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(7);
  });

  it("hashes captured leaderboard rows independently of upstream object key order", async () => {
    const row = {
      url: "https://www.skills.sh/owner/repo/skill",
      sourceType: "github",
      source: "owner/repo",
      slug: "skill",
      name: "Skill",
      installs: 42,
      installUrl: "https://github.com/owner/repo",
      id: "owner/repo/skill",
    };
    const pages = [
      {
        data: [row],
        pagination: { page: 0, perPage: 500, total: 1, hasMore: false },
      },
      {
        data: [],
        pagination: { page: 1, perPage: 500, total: 1, hasMore: false },
      },
    ];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/v1/skills?page=")) {
        return new Response(JSON.stringify(pages.shift()));
      }
      if (url.includes("/api/v1/skills/search?")) {
        return new Response(
          JSON.stringify({
            count: 0,
            data: [],
            durationMs: 1,
            query: "skill",
            searchType: "full-text",
          }),
        );
      }
      if (url.endsWith("/api/v1/skills/owner/repo/skill")) {
        return new Response(
          JSON.stringify({
            files: [],
            hash: "a".repeat(64),
            id: row.id,
            installs: row.installs,
            slug: row.slug,
            source: row.source,
          }),
        );
      }
      if (url.includes("?_rsc=")) {
        return new Response("0:{}", { headers: { "Content-Type": "text/x-component" } });
      }
      if (url === row.url) {
        return new Response("<!doctype html>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const measured = await measureSkillsShMirrorProofSource({
      oidcToken: "oidc-token",
      fetchImpl: fetchImpl as typeof fetch,
      minimumApiRequestIntervalMs: 0,
    });

    const capturedRows = measured.sourcePages[0]!.rows;
    expect(Object.keys(capturedRows[0]!)).toEqual([
      "id",
      "installUrl",
      "installs",
      "name",
      "slug",
      "source",
      "sourceType",
      "url",
    ]);
    expect(measured.sourcePages[0]!.contentHash).toBe(
      createHash("sha256").update(JSON.stringify(capturedRows)).digest("hex"),
    );
  });

  it("round-trips immutable proof source metadata through the run snapshot", () => {
    const evidence = {
      pagination: {
        endpointExhausted: true as const,
        databaseCoverage: "leaderboard-only" as const,
        page0: { page: 0, perPage: 500, total: 9_571, hasMore: true },
        requestedPages: [
          {
            page: 0,
            count: 500,
            hasMore: true,
            identityHash: "page-0",
            contentHash: "content-page-0",
          },
        ],
        finalNonemptyPage: {
          page: 19,
          count: 71,
          pagination: { page: 19, perPage: 500, total: 9_571, hasMore: false },
        },
        firstBeyondEndPage: {
          page: 20,
          count: 0,
          pagination: { page: 20, perPage: 500, total: 9_571, hasMore: false },
        },
        uniqueIds: 9_571,
        duplicateIds: 0,
      },
      fields: {
        sampledExternalId: "vercel-labs/skills/find-skills",
        leaderboard: {
          topLevelKeys: ["data", "pagination"],
          paginationKeys: ["hasMore", "page", "perPage", "total"],
          rowKeys: ["id"],
          taxonomyFields: [],
        },
        search: { topLevelKeys: ["data"], rowKeys: ["id"], taxonomyFields: [] },
        detail: { topLevelKeys: ["id"], fileKeys: [], taxonomyFields: [] },
        page: {
          url: "https://www.skills.sh/vercel-labs/skills/find-skills",
          jsonLdDocuments: [],
          taxonomyFields: [],
        },
        rsc: { objectKeys: [], taxonomyFields: [] },
        normalizedUpstreamTaxonomyFields: [],
      },
    };
    const snapshotId = buildSkillsShMirrorProofSnapshotId({
      catalogTotal: 9_571,
      controlledExternalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
      controlledOverlayExternalIds: ["patrick-erichsen/skills/html"],
      controlledSupplementExternalIds: ["steipete/clawdis/discrawl"],
      evidence,
    });
    expect(parseSkillsShMirrorProofSnapshotId(snapshotId)).toEqual({
      catalogTotal: 9_571,
      controlledExternalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
      controlledOverlayExternalIds: ["patrick-erichsen/skills/html"],
      controlledSupplementExternalIds: ["steipete/clawdis/discrawl"],
      sourceSnapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      evidence,
    });
    const changedSnapshotId = buildSkillsShMirrorProofSnapshotId({
      catalogTotal: 9_571,
      controlledExternalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
      controlledOverlayExternalIds: ["patrick-erichsen/skills/html"],
      controlledSupplementExternalIds: ["steipete/clawdis/discrawl"],
      evidence: {
        ...evidence,
        pagination: {
          ...evidence.pagination,
          requestedPages: [
            {
              page: 0,
              count: 500,
              hasMore: true,
              identityHash: "different-page-0",
              contentHash: "different-content-page-0",
            },
          ],
        },
      },
    });
    expect(snapshotId.split(".").slice(0, 2).join(".")).not.toBe(
      changedSnapshotId.split(".").slice(0, 2).join("."),
    );
    const changedPartitionSnapshotId = buildSkillsShMirrorProofSnapshotId({
      catalogTotal: 9_571,
      controlledExternalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
      controlledOverlayExternalIds: ["steipete/clawdis/discrawl"],
      controlledSupplementExternalIds: ["patrick-erichsen/skills/html"],
      evidence,
    });
    const [changedPayload] = changedPartitionSnapshotId.split(".");
    const [, snapshotHash, encodedEvidence] = snapshotId.split(".");
    expect(() =>
      parseSkillsShMirrorProofSnapshotId([changedPayload, snapshotHash, encodedEvidence].join(".")),
    ).toThrow("skills.sh mirror proof source metadata is invalid");
    const tamperedSnapshotId = snapshotId.replace(/.$/, (value) => (value === "A" ? "B" : "A"));
    expect(() => parseSkillsShMirrorProofSnapshotId(tamperedSnapshotId)).toThrow(
      "skills.sh mirror proof source metadata is invalid",
    );
  });

  it("rejects proof metadata redirects outside the exact skills.sh route", async () => {
    const row = {
      id: "owner/repo/skill",
      installUrl: "https://github.com/owner/repo",
      installs: 1,
      name: "Skill",
      slug: "skill",
      source: "owner/repo",
      sourceType: "github",
      url: "https://www.skills.sh/owner/repo/skill",
    };
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/v1/skills?page=0")) {
        return new Response(
          JSON.stringify({
            data: [row],
            pagination: { page: 0, perPage: 500, total: 1, hasMore: false },
          }),
        );
      }
      if (url.includes("/api/v1/skills?page=1")) {
        return new Response(
          JSON.stringify({
            data: [],
            pagination: { page: 1, perPage: 500, total: 1, hasMore: false },
          }),
        );
      }
      if (url.includes("/api/v1/skills/search?")) {
        return new Response(JSON.stringify({ data: [row] }));
      }
      if (url.endsWith("/api/v1/skills/owner/repo/skill")) {
        return new Response(
          JSON.stringify({
            id: row.id,
            source: row.source,
            slug: row.slug,
            installs: row.installs,
            hash: "a".repeat(64),
            files: [],
          }),
        );
      }
      if (url === row.url) {
        return new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1/internal" },
        });
      }
      throw new Error(`unexpected URL ${url}`);
    });

    await expect(
      measureSkillsShMirrorProofSource({
        oidcToken: "oidc-token",
        fetchImpl: fetchImpl as typeof fetch,
        minimumApiRequestIntervalMs: 0,
      }),
    ).rejects.toThrow("outside the exact skills.sh route");
    expect(fetchImpl).not.toHaveBeenCalledWith("http://127.0.0.1/internal", expect.anything());
  });

  it("rejects duplicate identities before declaring the leaderboard exhausted", async () => {
    const duplicateRow = {
      id: "owner/repo/duplicate",
      installUrl: "https://github.com/owner/repo",
      installs: 1,
      name: "Duplicate",
      slug: "duplicate",
      source: "owner/repo",
      sourceType: "github",
      url: "https://www.skills.sh/owner/repo/duplicate",
    };
    const pages = [
      {
        data: [duplicateRow],
        pagination: { page: 0, perPage: 500, total: 2, hasMore: true },
      },
      {
        data: [duplicateRow],
        pagination: { page: 1, perPage: 500, total: 2, hasMore: false },
      },
    ];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(pages.shift())));

    await expect(
      measureSkillsShMirrorProofSource({
        oidcToken: "oidc-token",
        fetchImpl,
        minimumApiRequestIntervalMs: 0,
      }),
    ).rejects.toThrow("duplicate identities");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects an over-capacity leaderboard from the first measured page", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [],
          pagination: { page: 0, perPage: 500, total: 50_001, hasMore: true },
        }),
      );
    });

    await expect(
      measureSkillsShMirrorProofSource({
        oidcToken: "oidc-token",
        fetchImpl: fetchImpl as typeof fetch,
        minimumApiRequestIntervalMs: 0,
      }),
    ).rejects.toThrow("skills.sh proof source total 50001 exceeds 50000 rows");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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
      upstreamSourceType: "github",
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
        sourceType: "Well-Known",
        url: "https://www.skills.sh/site/open.feishu.cn/lark-doc",
      }),
    ).toMatchObject({
      externalId: "open.feishu.cn/lark-doc",
      sourceType: "well-known",
      upstreamSourceType: "well-known",
      sourceHost: "open.feishu.cn",
      slug: "lark-doc",
      upstreamInstalls: 7,
    });
  });

  it("uses an exact GitHub install identity when the source type marker drifts", () => {
    const liveRow = {
      id: "larksuite/cli/lark-doc",
      installUrl: "https://github.com/larksuite/cli.git",
      installs: 383_123,
      name: "lark-doc",
      slug: "lark-doc",
      source: "larksuite/cli",
      sourceType: " GitHub-Repository ",
      url: "https://skills.sh/larksuite/cli/lark-doc",
    };
    expect(buildSkillsShMirrorObservation(liveRow)).toMatchObject({
      externalId: "larksuite/cli/lark-doc",
      sourceType: "github",
      upstreamSourceType: "github-repository",
      owner: "larksuite",
      repo: "cli",
      slug: "lark-doc",
      canonicalRepoUrl: "https://github.com/larksuite/cli",
      upstreamInstalls: 383_123,
    });
  });

  it("normalizes advisory source types to the persisted token grammar", () => {
    const liveRow = {
      id: "larksuite/cli/lark-doc",
      installUrl: "https://github.com/larksuite/cli",
      installs: 383_123,
      name: "lark-doc",
      slug: "lark-doc",
      source: "larksuite/cli",
      sourceType: ".GitHub_Repository.",
      url: "https://skills.sh/larksuite/cli/lark-doc",
    };
    expect(buildSkillsShMirrorObservation(liveRow)).toMatchObject({
      sourceType: "github",
      upstreamSourceType: "github_repository",
    });
    expect(buildSkillsShMirrorObservation({ ...liveRow, sourceType: "__" })).toMatchObject({
      sourceType: "github",
      upstreamSourceType: "missing",
    });
  });

  it("uses only the labeled Repository section for an ambiguous GitHub-backed row", () => {
    const liveRow = {
      id: "larksuite/cli/lark-doc",
      installUrl: null,
      installs: 383_123,
      name: "lark-doc",
      slug: "lark-doc",
      source: "larksuite/cli",
      sourceType: "well-known",
      url: "https://www.skills.sh/larksuite/cli/lark-doc",
    };
    const html = `
      <main>
        <article>
          <h2>Repository</h2>
          <a href="https://github.com/attacker/readme">README repository link</a>
        </article>
        <section class="bg-background py-8">
          <div><span>Repository</span></div>
          <a href="https://github.com/larksuite/cli">larksuite/cli</a>
        </section>
      </main>
    `;
    expect(buildSkillsShMirrorObservation(liveRow, html)).toMatchObject({
      externalId: "larksuite/cli/lark-doc",
      sourceType: "github",
      upstreamSourceType: "well-known",
      owner: "larksuite",
      repo: "cli",
      canonicalRepoUrl: "https://github.com/larksuite/cli",
    });

    const invalidPages = [
      `<section class="bg-background py-8"><div><span>Repository</span></div><a href="https://github.com/other/cli">other/cli</a></section>`,
      `<section class="bg-background py-8"><div><span>Repository</span></div><a href="https://github.com/larksuite/cli/tree/main">larksuite/cli</a></section>`,
      `<section class="bg-background py-8"><div><span>Repository</span></div><a href="https://github.com/larksuite/cli">larksuite/cli</a><a href="https://github.com/other/repo">other/repo</a></section>`,
    ];
    for (const invalidPage of invalidPages) {
      expect(() => buildSkillsShMirrorObservation(liveRow, invalidPage)).toThrow(
        "Unsupported skills.sh mirror identity",
      );
    }
    expect(() =>
      buildSkillsShMirrorObservation(
        { ...liveRow, url: "https://www.skills.sh/larksuite/cli/other" },
        html,
      ),
    ).toThrow("Unsupported skills.sh mirror identity");
  });

  it("rejects conflicting GitHub structural identity without exposing the install URL", () => {
    const liveRow = {
      id: "larksuite/cli/lark-doc",
      installUrl: "https://github.com/larksuite/cli",
      installs: 383_123,
      name: "lark-doc",
      slug: "lark-doc",
      source: "larksuite/cli",
      sourceType: "repository",
      url: "https://skills.sh/larksuite/cli/lark-doc",
    };
    const invalidRows = [
      { ...liveRow, installUrl: "https://github.com/larksuite/docs" },
      { ...liveRow, installUrl: "https://github.com/larksuite/cli/tree/main" },
      { ...liveRow, id: "larksuite/docs/lark-doc" },
      { ...liveRow, source: "larksuite/docs" },
      { ...liveRow, slug: "lark-sheets" },
      { ...liveRow, installUrl: null, url: "https://skills.sh/larksuite/cli/other-skill" },
      { ...liveRow, installUrl: "https://example.com/larksuite/cli" },
      { ...liveRow, installUrl: "https://github.com:8443/larksuite/cli" },
      { ...liveRow, installUrl: null, url: "https://skills.sh:8443/larksuite/cli/lark-doc" },
    ];
    for (const row of invalidRows) {
      try {
        buildSkillsShMirrorObservation(row);
        throw new Error("expected invalid skills.sh identity to be rejected");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain("Unsupported skills.sh mirror identity");
        expect(message).toContain("sourceType=repository");
        expect(message).toContain(`installUrlPresent=${row.installUrl !== null}`);
        if (row.installUrl) expect(message).not.toContain(row.installUrl);
      }
    }
  });

  it("requires the exact skills.sh site route for well-known identity", () => {
    const liveRow = {
      id: "open.feishu.cn/lark-doc",
      installUrl: null,
      installs: 7,
      name: "lark-doc",
      slug: "lark-doc",
      source: "open.feishu.cn",
      sourceType: "well-known",
      url: "https://skills.sh/site/open.feishu.cn/lark-doc",
    };
    expect(() =>
      buildSkillsShMirrorObservation({
        ...liveRow,
        url: "https://skills.sh/open.feishu.cn/lark-doc",
      }),
    ).toThrow("Unsupported skills.sh mirror identity");
    expect(() =>
      buildSkillsShMirrorObservation({
        ...liveRow,
        installUrl: "https://github.com/attacker/repo",
        sourceType: "github",
      }),
    ).toThrow("Unsupported skills.sh mirror identity");
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

  it("derives a deterministic content hash from the full detail before truncation", () => {
    const detail = buildSkillsShMirrorDetail(
      {
        id: "patrick-erichsen/skills/html",
        source: "patrick-erichsen/skills",
        slug: "html",
        installs: 42,
        hash: null,
        files: [{ path: "SKILL.md", contents: "abcdef" }],
      },
      3,
    );

    expect(detail).toMatchObject({
      sourceContentHash: "bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1fc6c5c6dcd93c4721",
      content: "abc",
      truncated: true,
    });
  });

  it("resolves an immutable GitHub path and commit from the exact full detail blob", async () => {
    const content = "# HTML Artifact Chooser\n";
    const boundedContent = content.slice(0, 8);
    const blobSha = createHash("sha1")
      .update(`blob ${Buffer.byteLength(content)}\0`)
      .update(content)
      .digest("hex");
    const commit = "050daba89f6b6636470add5cb300aac46a412cf8";
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://github.com/patrick-erichsen/skills/archive/HEAD.zip") {
        return new Response(null, {
          status: 302,
          headers: {
            location: `https://codeload.github.com/Patrick-Erichsen/skills/zip/${commit}`,
          },
        });
      }
      if (url.includes(`/git/trees/${commit}?recursive=1`)) {
        return new Response(
          JSON.stringify({
            truncated: false,
            tree: [
              { path: "skills/html/SKILL.md", type: "blob", sha: blobSha },
              { path: "README.md", type: "blob", sha: "f".repeat(40) },
            ],
          }),
        );
      }
      return new Response("not found", { status: 404 });
    });

    await expect(
      resolveSkillsShMirrorGitHubLocators(
        [
          {
            externalId: "patrick-erichsen/skills/html",
            sourceType: "github",
            owner: "patrick-erichsen",
            repo: "skills",
            slug: "html",
            detail: {
              path: "SKILL.md",
              content: boundedContent,
              truncated: true,
            },
          },
        ],
        {
          fetchImpl: fetchImpl as typeof fetch,
          fullDetailContentByExternalId: new Map([["patrick-erichsen/skills/html", content]]),
        },
      ),
    ).resolves.toEqual({
      rows: [
        expect.objectContaining({
          githubPath: "skills/html",
          githubCommit: commit,
        }),
      ],
      sourceRequests: 2,
      sourceBytes: expect.any(Number),
    });
  });

  it("derives the GitHub folder from a repository-relative detail path", async () => {
    const content = "# Lark Doc\n";
    const blobSha = createHash("sha1")
      .update(`blob ${Buffer.byteLength(content)}\0`)
      .update(content)
      .digest("hex");
    const commit = "050daba89f6b6636470add5cb300aac46a412cf8";
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://github.com/larksuite/cli/archive/HEAD.zip") {
        return new Response(null, {
          status: 302,
          headers: { location: `https://codeload.github.com/larksuite/cli/zip/${commit}` },
        });
      }
      if (url.includes(`/git/trees/${commit}?recursive=1`)) {
        return new Response(
          JSON.stringify({
            truncated: false,
            tree: [{ path: "skills/lark-doc/SKILL.md", type: "blob", sha: blobSha }],
          }),
        );
      }
      return new Response("not found", { status: 404 });
    });

    const result = await resolveSkillsShMirrorGitHubLocators(
      [
        {
          externalId: "larksuite/cli/lark-doc",
          sourceType: "github",
          owner: "larksuite",
          repo: "cli",
          slug: "lark-doc",
          detail: {
            path: "skills/lark-doc/SKILL.md",
            content,
            truncated: false,
          },
        },
      ],
      { fetchImpl: fetchImpl as typeof fetch },
    );

    expect(result.rows).toEqual([
      expect.objectContaining({
        githubPath: "skills/lark-doc",
        githubCommit: commit,
      }),
    ]);
  });

  it("propagates lease heartbeat failures during GitHub locator resolution", async () => {
    const beforeRequest = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("mirror batch lease expired"));
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://github.com/patrick-erichsen/skills/archive/HEAD.zip") {
        return new Response(null, {
          status: 302,
          headers: {
            location:
              "https://codeload.github.com/patrick-erichsen/skills/zip/050daba89f6b6636470add5cb300aac46a412cf8",
          },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(
      resolveSkillsShMirrorGitHubLocators(
        [
          {
            externalId: "patrick-erichsen/skills/html",
            sourceType: "github",
            owner: "patrick-erichsen",
            repo: "skills",
            slug: "html",
            detail: {
              path: "SKILL.md",
              content: "# HTML Artifact Chooser\n",
              truncated: false,
            },
          },
        ],
        { fetchImpl: fetchImpl as typeof fetch, beforeRequest },
      ),
    ).rejects.toThrow("mirror batch lease expired");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refreshes a repository HEAD snapshot for each mirror batch", async () => {
    const content = "# HTML Artifact Chooser\n";
    const blobSha = createHash("sha1")
      .update(`blob ${Buffer.byteLength(content)}\0`)
      .update(content)
      .digest("hex");
    const commits = ["0".repeat(39) + "1", "0".repeat(39) + "2"];
    let archiveRequest = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://github.com/patrick-erichsen/skills/archive/HEAD.zip") {
        const commit = commits[archiveRequest++]!;
        return new Response(null, {
          status: 302,
          headers: {
            location: `https://codeload.github.com/patrick-erichsen/skills/zip/${commit}`,
          },
        });
      }
      if (url.includes("/git/trees/")) {
        return new Response(
          JSON.stringify({
            truncated: false,
            tree: [{ path: "skills/html/SKILL.md", type: "blob", sha: blobSha }],
          }),
        );
      }
      return new Response("not found", { status: 404 });
    });
    const rows = [
      {
        externalId: "patrick-erichsen/skills/html",
        sourceType: "github",
        owner: "patrick-erichsen",
        repo: "skills",
        slug: "html",
        detail: { path: "SKILL.md", content, truncated: false },
      },
    ];

    const first = await resolveSkillsShMirrorGitHubLocators(rows, {
      fetchImpl: fetchImpl as typeof fetch,
    });
    const second = await resolveSkillsShMirrorGitHubLocators(rows, {
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(first.rows[0]).toMatchObject({ githubCommit: commits[0] });
    expect(second.rows[0]).toMatchObject({ githubCommit: commits[1] });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("forwards authoritative GitHub locators into a live mirror batch", async () => {
    const content = "# HTML Artifact Chooser\n";
    const commit = "050daba89f6b6636470add5cb300aac46a412cf8";
    const blobSha = createHash("sha1")
      .update(`blob ${Buffer.byteLength(content)}\0`)
      .update(content)
      .digest("hex");
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("?page=0&per_page=500")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "patrick-erichsen/skills/html",
                installUrl: "https://github.com/patrick-erichsen/skills",
                installs: 42,
                name: "HTML Artifact Chooser",
                slug: "html",
                source: "patrick-erichsen/skills",
                sourceType: "github",
                url: "https://skills.sh/patrick-erichsen/skills/html",
              },
            ],
            pagination: { page: 0, perPage: 500, total: 1, hasMore: false },
          }),
        );
      }
      if (url.includes("/api/v1/skills/audit/")) {
        return new Response(JSON.stringify({ audits: [] }));
      }
      if (url.includes("/api/v1/skills/patrick-erichsen/skills/html")) {
        return new Response(
          JSON.stringify({
            id: "patrick-erichsen/skills/html",
            source: "patrick-erichsen/skills",
            slug: "html",
            installs: 42,
            hash: null,
            files: [{ path: "SKILL.md", contents: content }],
          }),
        );
      }
      if (url === "https://github.com/patrick-erichsen/skills/archive/HEAD.zip") {
        return new Response(null, {
          status: 302,
          headers: {
            location: `https://codeload.github.com/Patrick-Erichsen/skills/zip/${commit}`,
          },
        });
      }
      if (url.includes(`/git/trees/${commit}?recursive=1`)) {
        return new Response(
          JSON.stringify({
            truncated: false,
            tree: [{ path: "skills/html/SKILL.md", type: "blob", sha: blobSha }],
          }),
        );
      }
      return new Response("unexpected request", { status: 500 });
    });

    const batch = await fetchSkillsShMirrorBatch(
      { page: 0, offset: 0, limit: 1, maxDetailBytes: 64 * 1024 },
      {
        oidcToken: "request-bound-oidc",
        fetchImpl: fetchImpl as typeof fetch,
      },
    );

    expect(batch).toMatchObject({
      sourceRequests: 5,
      rows: [
        {
          externalId: "patrick-erichsen/skills/html",
          githubPath: "skills/html",
          githubCommit: commit,
        },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
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
      if (url.includes("/api/v1/skills/audit/")) {
        return new Response(
          JSON.stringify({
            id: "open.feishu.cn/lark-doc",
            source: "open.feishu.cn",
            slug: "lark-doc",
            audits: [
              {
                provider: "Socket",
                slug: "socket",
                status: "pass",
                auditedAt: "2026-07-22T20:02:00.000Z",
              },
            ],
          }),
        );
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
        githubLocatorResolver: null,
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
              sourceUrl: "https://www.skills.sh/site/open.feishu.cn/lark-doc/security/socket",
              sourceCheckedAt: "2026-07-22T20:02:00.000Z",
            },
            snyk: { status: "unavailable" },
          },
          detail: { contentKind: "skill-md", path: "SKILL.md" },
        },
      ],
      sourceRequests: 3,
    });
  });

  it("uses the durable captured page without refetching the mutable leaderboard", async () => {
    const row = {
      id: "vercel-labs/skills/find-skills",
      installUrl: "https://github.com/vercel-labs/skills",
      installs: 42,
      name: "Find Skills",
      slug: "find-skills",
      source: "vercel-labs/skills",
      sourceType: "github",
      url: "https://skills.sh/vercel-labs/skills/find-skills",
    };
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("?page=")) throw new Error("leaderboard refetch is forbidden");
      if (url.includes("/api/v1/skills/audit/")) {
        return new Response(JSON.stringify({ audits: [] }));
      }
      return new Response(
        JSON.stringify({
          id: row.id,
          source: row.source,
          slug: row.slug,
          installs: row.installs,
          hash: "a".repeat(64),
          files: [{ path: "SKILL.md", contents: "# Find Skills" }],
        }),
      );
    });

    const batch = await fetchSkillsShMirrorBatch(
      { page: 3, offset: 0, limit: 1, maxDetailBytes: 64 * 1024 },
      {
        oidcToken: "request-bound-oidc",
        fetchImpl: fetchImpl as typeof fetch,
        githubLocatorResolver: null,
        sourcePage: {
          data: [row],
          pagination: { page: 3, perPage: 500, total: 1, hasMore: false },
        },
      },
    );

    expect(batch).toMatchObject({
      page: 3,
      pageLength: 1,
      sourceTotal: 1,
      sourceRequests: 2,
      rows: [{ externalId: row.id }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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

  it("keeps a mirror row when the authenticated audit endpoint has no audits", async () => {
    const fetchImpl = vi.fn(async (urlInput: string | URL | Request) => {
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
      if (url.includes("/api/v1/skills/audit/")) {
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      }
      if (url.includes("/api/v1/skills/")) {
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
      }
      return new Response("unexpected request", { status: 500 });
    });

    const batch = await fetchSkillsShMirrorBatch(
      { page: 0, offset: 0, limit: 1, maxDetailBytes: 64 },
      {
        oidcToken: "request-bound-oidc",
        fetchImpl: fetchImpl as typeof fetch,
        githubLocatorResolver: null,
      },
    );

    expect(batch.rows).toEqual([
      expect.objectContaining({
        externalId: "vercel-labs/skills/find-skills",
        upstreamScanners: {
          genAgentTrustHub: { status: "unavailable" },
          socket: { status: "unavailable" },
          snyk: { status: "unavailable" },
        },
        detail: expect.objectContaining({
          contentKind: "skill-md",
          path: "SKILL.md",
        }),
      }),
    ]);
    expect(batch.sourceRequests).toBe(3);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://skills.sh/api/v1/skills/audit/vercel-labs/skills/find-skills",
      {
        headers: {
          Accept: "application/json",
          Authorization: "Bearer request-bound-oidc",
        },
      },
    );
  });

  it("fetches the exact ambiguous source page only for identity resolution", async () => {
    let identityPageAttempts = 0;
    const fetchImpl = vi.fn(async (urlInput: string | URL | Request) => {
      const url = String(urlInput);
      if (url.includes("?page=0&per_page=500")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "larksuite/cli/lark-doc",
                installUrl: null,
                installs: 383_123,
                name: "lark-doc",
                slug: "lark-doc",
                source: "larksuite/cli",
                sourceType: "well-known",
                url: "https://www.skills.sh/larksuite/cli/lark-doc",
              },
            ],
            pagination: { page: 0, perPage: 500, total: 1, hasMore: false },
          }),
        );
      }
      if (url === "https://www.skills.sh/larksuite/cli/lark-doc") {
        identityPageAttempts += 1;
        if (identityPageAttempts === 1) {
          return new Response("retry", {
            status: 503,
            headers: { "retry-after": "0" },
          });
        }
        return new Response(
          `<main><section class="bg-background py-8"><div><span>Repository</span></div><a href="https://github.com/larksuite/cli.git">larksuite/cli</a></section></main>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
      if (url.includes("/api/v1/skills/audit/")) {
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      }
      if (url.includes("/api/v1/skills/larksuite/cli/lark-doc")) {
        return new Response(
          JSON.stringify({
            id: "larksuite/cli/lark-doc",
            source: "larksuite/cli",
            slug: "lark-doc",
            installs: 383_123,
            hash: "c".repeat(64),
            files: [{ path: "skills/lark-doc/SKILL.md", contents: "# Lark Doc" }],
          }),
        );
      }
      return new Response("unexpected request", { status: 500 });
    });

    const batch = await fetchSkillsShMirrorBatch(
      { page: 0, offset: 0, limit: 1, maxDetailBytes: 64 },
      {
        oidcToken: "request-bound-oidc",
        fetchImpl: fetchImpl as typeof fetch,
        githubLocatorResolver: null,
      },
    );

    expect(batch.rows).toEqual([
      expect.objectContaining({
        externalId: "larksuite/cli/lark-doc",
        sourceType: "github",
        upstreamSourceType: "well-known",
        owner: "larksuite",
        repo: "cli",
        canonicalRepoUrl: "https://github.com/larksuite/cli",
      }),
    ]);
    expect(batch.sourceRequests).toBe(5);
    expect(fetchImpl).toHaveBeenCalledWith("https://www.skills.sh/larksuite/cli/lark-doc", {
      headers: { Accept: "text/html" },
      redirect: "manual",
    });
  });

  it("delegates long identity-page Retry-After waits to durable recovery", async () => {
    vi.useFakeTimers();
    let identityPageAttempts = 0;
    const fetchImpl = vi.fn(async (urlInput: string | URL | Request) => {
      const url = String(urlInput);
      if (url.includes("?page=0&per_page=500")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "larksuite/cli/lark-doc",
                installUrl: null,
                installs: 383_123,
                name: "lark-doc",
                slug: "lark-doc",
                source: "larksuite/cli",
                sourceType: "well-known",
                url: "https://www.skills.sh/larksuite/cli/lark-doc",
              },
            ],
            pagination: { page: 0, perPage: 500, total: 1, hasMore: false },
          }),
        );
      }
      if (url === "https://www.skills.sh/larksuite/cli/lark-doc") {
        identityPageAttempts += 1;
        return new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "120" },
        });
      }
      return new Response("unexpected request", { status: 500 });
    });

    let error: unknown;
    void fetchSkillsShMirrorBatch(
      { page: 0, offset: 0, limit: 1, maxDetailBytes: 64 },
      {
        oidcToken: "request-bound-oidc",
        fetchImpl: fetchImpl as typeof fetch,
        githubLocatorResolver: null,
      },
    ).catch((value: unknown) => {
      error = value;
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(skillsShSourceRetryAfterSeconds(error)).toBe(120);
    expect(identityPageAttempts).toBe(1);
  });

  it("quarantines an identity page redirect outside the exact skills.sh route", async () => {
    let redirectBodyCanceled = false;
    const fetchImpl = vi.fn(async (urlInput: string | URL | Request) => {
      const url = String(urlInput);
      if (url.includes("?page=0&per_page=500")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "larksuite/cli/lark-doc",
                installUrl: null,
                installs: 383_123,
                name: "lark-doc",
                slug: "lark-doc",
                source: "larksuite/cli",
                sourceType: "well-known",
                url: "https://skills.sh/larksuite/cli/lark-doc",
              },
            ],
            pagination: { page: 0, perPage: 500, total: 1, hasMore: false },
          }),
        );
      }
      if (url === "https://skills.sh/larksuite/cli/lark-doc") {
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new TextEncoder().encode("redirecting"));
            },
            cancel() {
              redirectBodyCanceled = true;
            },
          }),
          {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data/" },
          },
        );
      }
      return new Response("unexpected request", { status: 500 });
    });

    const batch = await fetchSkillsShMirrorBatch(
      { page: 0, offset: 0, limit: 1, maxDetailBytes: 64 },
      {
        oidcToken: "request-bound-oidc",
        fetchImpl: fetchImpl as typeof fetch,
        githubLocatorResolver: null,
      },
    );

    expect(batch.rows).toEqual([
      {
        quarantined: true,
        externalId: "larksuite/cli/lark-doc",
        upstreamSourceType: "well-known",
        reason: "identity-page-redirect",
      },
    ]);
    expect(redirectBodyCanceled).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("quarantines an ambiguous HTML 404 and continues the source batch", async () => {
    const fetchImpl = vi.fn(async (urlInput: string | URL | Request) => {
      const url = String(urlInput);
      if (url.includes("?page=0&per_page=500")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "larksuite/cli/lark-doc",
                installUrl: null,
                installs: 383_123,
                name: "lark-doc",
                slug: "lark-doc",
                source: "larksuite/cli",
                sourceType: "well-known",
                url: "https://www.skills.sh/larksuite/cli/lark-doc",
              },
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
            pagination: { page: 0, perPage: 500, total: 2, hasMore: false },
          }),
        );
      }
      if (url === "https://www.skills.sh/larksuite/cli/lark-doc") {
        return new Response("not found", { status: 404 });
      }
      if (url.includes("/api/v1/skills/audit/")) {
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      }
      if (url.includes("/api/v1/skills/vercel-labs/skills/find-skills")) {
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
      }
      return new Response("unexpected request", { status: 500 });
    });

    const batch = await fetchSkillsShMirrorBatch(
      { page: 0, offset: 0, limit: 2, maxDetailBytes: 64 },
      {
        oidcToken: "request-bound-oidc",
        fetchImpl: fetchImpl as typeof fetch,
        githubLocatorResolver: null,
      },
    );

    expect(batch.rows).toEqual([
      {
        quarantined: true,
        externalId: "larksuite/cli/lark-doc",
        upstreamSourceType: "well-known",
        reason: "identity-page-http-404",
      },
      expect.objectContaining({
        externalId: "vercel-labs/skills/find-skills",
        sourceType: "github",
        upstreamSourceType: "github",
      }),
    ]);
    expect(batch.sourceRequests).toBe(4);
    expect(fetchImpl).not.toHaveBeenCalledWith(
      "https://skills.sh/api/v1/skills/larksuite/cli/lark-doc",
      expect.anything(),
    );
    expect(fetchImpl).not.toHaveBeenCalledWith(
      "https://skills.sh/api/v1/skills/audit/larksuite/cli/lark-doc",
      expect.anything(),
    );
  });

  it("cancels an oversized chunked identity page before buffering the full body", async () => {
    let canceled = false;
    let chunkIndex = 0;
    const fetchImpl = vi.fn(async (urlInput: string | URL | Request) => {
      const url = String(urlInput);
      if (url.includes("?page=0&per_page=500")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "larksuite/cli/lark-doc",
                installUrl: null,
                installs: 383_123,
                name: "lark-doc",
                slug: "lark-doc",
                source: "larksuite/cli",
                sourceType: "well-known",
                url: "https://www.skills.sh/larksuite/cli/lark-doc",
              },
            ],
            pagination: { page: 0, perPage: 500, total: 1, hasMore: false },
          }),
        );
      }
      if (url === "https://www.skills.sh/larksuite/cli/lark-doc") {
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              chunkIndex += 1;
              if (chunkIndex <= 4) {
                controller.enqueue(new Uint8Array(256 * 1024));
              } else {
                controller.close();
              }
            },
            cancel() {
              canceled = true;
            },
          }),
          { headers: { "content-type": "text/html" } },
        );
      }
      return new Response("unexpected request", { status: 500 });
    });

    const batch = await fetchSkillsShMirrorBatch(
      { page: 0, offset: 0, limit: 1, maxDetailBytes: 64 },
      {
        oidcToken: "request-bound-oidc",
        fetchImpl: fetchImpl as typeof fetch,
        githubLocatorResolver: null,
      },
    );

    expect(batch.rows).toEqual([
      {
        quarantined: true,
        externalId: "larksuite/cli/lark-doc",
        upstreamSourceType: "well-known",
        reason: "identity-page-too-large",
      },
    ]);
    expect(canceled).toBe(true);
  });

  it("retries a failed identity response stream without aborting the source batch", async () => {
    let identityPageAttempts = 0;
    const fetchImpl = vi.fn(async (urlInput: string | URL | Request) => {
      const url = String(urlInput);
      if (url.includes("?page=0&per_page=500")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "larksuite/cli/lark-doc",
                installUrl: null,
                installs: 383_123,
                name: "lark-doc",
                slug: "lark-doc",
                source: "larksuite/cli",
                sourceType: "well-known",
                url: "https://www.skills.sh/larksuite/cli/lark-doc",
              },
            ],
            pagination: { page: 0, perPage: 500, total: 1, hasMore: false },
          }),
        );
      }
      if (url === "https://www.skills.sh/larksuite/cli/lark-doc") {
        identityPageAttempts += 1;
        if (identityPageAttempts === 1) {
          let sentChunk = false;
          return new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (!sentChunk) {
                  sentChunk = true;
                  controller.enqueue(new Uint8Array(64 * 1024));
                } else {
                  controller.error(new Error("connection reset"));
                }
              },
            }),
            { headers: { "content-type": "text/html" } },
          );
        }
        return new Response(
          `<section class="bg-background py-8"><div><span>Repository</span></div><a href="https://github.com/larksuite/cli">larksuite/cli</a></section>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      if (url.includes("/api/v1/skills/audit/")) {
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      }
      if (url.includes("/api/v1/skills/larksuite/cli/lark-doc")) {
        return new Response(
          JSON.stringify({
            id: "larksuite/cli/lark-doc",
            source: "larksuite/cli",
            slug: "lark-doc",
            installs: 383_123,
            hash: "c".repeat(64),
            files: [{ path: "skills/lark-doc/SKILL.md", contents: "# Lark Doc" }],
          }),
        );
      }
      return new Response("unexpected request", { status: 500 });
    });

    const batch = await fetchSkillsShMirrorBatch(
      { page: 0, offset: 0, limit: 1, maxDetailBytes: 64 },
      {
        oidcToken: "request-bound-oidc",
        fetchImpl: fetchImpl as typeof fetch,
        githubLocatorResolver: null,
      },
    );

    expect(batch.rows).toEqual([
      expect.objectContaining({
        externalId: "larksuite/cli/lark-doc",
        sourceType: "github",
        upstreamSourceType: "well-known",
      }),
    ]);
    expect(identityPageAttempts).toBe(2);
    expect(batch.sourceRequests).toBe(5);
    expect(batch.sourceBytes).toBeGreaterThan(64 * 1024);
  });

  it("quarantines exhausted identity-page 5xx retries as a transient fetch failure", async () => {
    let identityPageAttempts = 0;
    const fetchImpl = vi.fn(async (urlInput: string | URL | Request) => {
      const url = String(urlInput);
      if (url.includes("?page=0&per_page=500")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "larksuite/cli/lark-doc",
                installUrl: null,
                installs: 383_123,
                name: "lark-doc",
                slug: "lark-doc",
                source: "larksuite/cli",
                sourceType: "well-known",
                url: "https://www.skills.sh/larksuite/cli/lark-doc",
              },
            ],
            pagination: { page: 0, perPage: 500, total: 1, hasMore: false },
          }),
        );
      }
      if (url === "https://www.skills.sh/larksuite/cli/lark-doc") {
        identityPageAttempts += 1;
        return new Response("unavailable", {
          status: 503,
          headers: { "retry-after": "0" },
        });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const batch = await fetchSkillsShMirrorBatch(
      { page: 0, offset: 0, limit: 1, maxDetailBytes: 64 },
      {
        oidcToken: "request-bound-oidc",
        fetchImpl: fetchImpl as typeof fetch,
        githubLocatorResolver: null,
      },
    );

    expect(batch.rows).toEqual([
      {
        quarantined: true,
        externalId: "larksuite/cli/lark-doc",
        upstreamSourceType: "well-known",
        reason: "identity-page-fetch-failed",
      },
    ]);
    expect(identityPageAttempts).toBe(4);
    expect(batch.sourceRequests).toBe(5);
  });

  it("quarantines an identity page without an explicit HTML content type", async () => {
    const fetchImpl = vi.fn(async (urlInput: string | URL | Request) => {
      const url = String(urlInput);
      if (url.includes("?page=0&per_page=500")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "larksuite/cli/lark-doc",
                installUrl: null,
                installs: 383_123,
                name: "lark-doc",
                slug: "lark-doc",
                source: "larksuite/cli",
                sourceType: "well-known",
                url: "https://www.skills.sh/larksuite/cli/lark-doc",
              },
            ],
            pagination: { page: 0, perPage: 500, total: 1, hasMore: false },
          }),
        );
      }
      if (url === "https://www.skills.sh/larksuite/cli/lark-doc") {
        return new Response(
          new TextEncoder().encode(
            `<section class="bg-background py-8"><div><span>Repository</span></div><a href="https://github.com/larksuite/cli">larksuite/cli</a></section>`,
          ),
        );
      }
      return new Response("unexpected request", { status: 500 });
    });

    const batch = await fetchSkillsShMirrorBatch(
      { page: 0, offset: 0, limit: 1, maxDetailBytes: 64 },
      {
        oidcToken: "request-bound-oidc",
        fetchImpl: fetchImpl as typeof fetch,
        githubLocatorResolver: null,
      },
    );

    expect(batch.rows).toEqual([
      {
        quarantined: true,
        externalId: "larksuite/cli/lark-doc",
        upstreamSourceType: "well-known",
        reason: "identity-page-content-type",
      },
    ]);
  });

  it("quarantines a slash-bearing detail slug and continues the source batch", async () => {
    const fetchImpl = vi.fn(async (urlInput: string | URL | Request) => {
      const url = String(urlInput);
      if (url.includes("?page=0&per_page=500")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "owner/repo/nested/skill",
                installUrl: "https://github.com/owner/repo",
                installs: 1,
                name: "Nested Skill",
                slug: "nested/skill",
                source: "owner/repo",
                sourceType: "github",
                url: "https://skills.sh/owner/repo/nested/skill",
              },
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
            pagination: { page: 0, perPage: 500, total: 2, hasMore: false },
          }),
        );
      }
      if (url.includes("/api/v1/skills/audit/")) {
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      }
      if (url.includes("/api/v1/skills/vercel-labs/skills/find-skills")) {
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
      }
      return new Response("unexpected request", { status: 500 });
    });

    const batch = await fetchSkillsShMirrorBatch(
      { page: 0, offset: 0, limit: 2, maxDetailBytes: 64 },
      {
        oidcToken: "request-bound-oidc",
        fetchImpl: fetchImpl as typeof fetch,
        githubLocatorResolver: null,
      },
    );

    expect(batch.rows).toEqual([
      {
        quarantined: true,
        externalId: "owner/repo/nested/skill",
        upstreamSourceType: "github",
        reason: "unsupported-identity",
      },
      expect.objectContaining({
        externalId: "vercel-labs/skills/find-skills",
        sourceType: "github",
        sourceContentHash: "a".repeat(64),
      }),
    ]);
    expect(batch.sourceRequests).toBe(3);
    expect(fetchImpl).not.toHaveBeenCalledWith(
      "https://skills.sh/api/v1/skills/owner/repo/nested/skill",
      expect.anything(),
    );
  });

  it("quarantines a malformed upstream source type instead of aborting the batch", async () => {
    const fetchImpl = vi.fn(async (urlInput: string | URL | Request) => {
      const url = String(urlInput);
      if (url.includes("?page=0&per_page=500")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "owner/repo/skill",
                installUrl: null,
                installs: 1,
                name: "Skill",
                slug: "skill",
                source: "owner/repo",
                sourceType: null,
                url: "https://www.skills.sh/owner/repo/skill",
              },
            ],
            pagination: { page: 0, perPage: 500, total: 1, hasMore: false },
          }),
        );
      }
      return new Response("unexpected request", { status: 500 });
    });

    const batch = await fetchSkillsShMirrorBatch(
      { page: 0, offset: 0, limit: 1, maxDetailBytes: 64 },
      {
        oidcToken: "request-bound-oidc",
        fetchImpl: fetchImpl as typeof fetch,
        githubLocatorResolver: null,
      },
    );

    expect(batch.rows).toEqual([
      {
        quarantined: true,
        externalId: "owner/repo/skill",
        upstreamSourceType: "missing",
        reason: "unsupported-identity",
      },
    ]);
  });

  it("fails closed when the authenticated audit endpoint rejects authorization", async () => {
    const fetchImpl = vi.fn(async (urlInput: string | URL | Request) => {
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
      if (url.includes("/api/v1/skills/audit/")) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
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

    await expect(
      fetchSkillsShMirrorBatch(
        { page: 0, offset: 0, limit: 1, maxDetailBytes: 64 },
        {
          oidcToken: "request-bound-oidc",
          fetchImpl: fetchImpl as typeof fetch,
          githubLocatorResolver: null,
        },
      ),
    ).rejects.toThrow("skills.sh catalog source returned HTTP 401");
  });

  it("retries transient audit responses and counts every request", async () => {
    let auditAttempts = 0;
    const fetchImpl = vi.fn(async (urlInput: string | URL | Request) => {
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
      if (url.includes("/api/v1/skills/audit/")) {
        auditAttempts += 1;
        if (auditAttempts === 1) {
          return new Response("busy", {
            status: 503,
            headers: { "retry-after": "0" },
          });
        }
        return new Response(
          JSON.stringify({
            id: "vercel-labs/skills/find-skills",
            source: "vercel-labs/skills",
            slug: "find-skills",
            audits: [],
          }),
        );
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
      {
        oidcToken: "request-bound-oidc",
        fetchImpl: fetchImpl as typeof fetch,
        githubLocatorResolver: null,
      },
    );

    expect(batch.sourceRequests).toBe(4);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("paces authenticated mirror API requests below the upstream minute limit", async () => {
    vi.useFakeTimers();
    const requestTimes: number[] = [];
    const fetchImpl = vi.fn(async (urlInput: string | URL | Request) => {
      requestTimes.push(Date.now());
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
      if (url.includes("/api/v1/skills/audit/")) {
        return new Response(JSON.stringify({ audits: [] }));
      }
      return new Response(
        JSON.stringify({
          hash: "a".repeat(64),
          files: [{ path: "SKILL.md", contents: "# Find Skills" }],
        }),
      );
    });

    const batchPromise = fetchSkillsShMirrorBatch(
      { page: 0, offset: 0, limit: 1, maxDetailBytes: 64 },
      {
        oidcToken: "request-bound-oidc",
        fetchImpl: fetchImpl as typeof fetch,
        minimumApiRequestIntervalMs: 125,
        githubLocatorResolver: null,
      },
    );
    await vi.runAllTimersAsync();
    await batchPromise;

    expect(requestTimes).toHaveLength(3);
    expect(requestTimes[1]! - requestTimes[0]!).toBeGreaterThanOrEqual(125);
    expect(requestTimes[2]! - requestTimes[1]!).toBeGreaterThanOrEqual(125);
    vi.useRealTimers();
  });

  it("honors the full Retry-After delay before retrying a 429", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    let canceledResponses = 0;
    const fetchImpl = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("rate limited"));
            },
            cancel() {
              canceledResponses += 1;
            },
          }),
          {
            status: 429,
            headers: { "retry-after": "17" },
          },
        );
      }
      return new Response(
        JSON.stringify({
          data: [],
          pagination: { page: 0, perPage: 500, total: 1, hasMore: false },
        }),
      );
    });

    const pagePromise = fetchSkillsShCatalogPage(
      { page: 0, perPage: 500 },
      { oidcToken: "request-bound-oidc", fetchImpl: fetchImpl as typeof fetch },
    );
    await vi.advanceTimersByTimeAsync(16_999);
    expect(attempts).toBe(1);
    expect(canceledResponses).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await pagePromise;
    expect(attempts).toBe(2);
  });

  it("preserves Retry-After when bounded source retries are exhausted", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => {
      return new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "17" },
      });
    });

    const pagePromise = fetchSkillsShCatalogPage(
      { page: 0, perPage: 500 },
      { oidcToken: "request-bound-oidc", fetchImpl: fetchImpl as typeof fetch },
    ).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await pagePromise;

    expect(error).toBeInstanceOf(Error);
    expect(skillsShSourceRetryAfterSeconds(error)).toBe(17);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("delegates long Retry-After waits without shortening the upstream cooldown", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "120" },
      });
    });

    const error = await fetchSkillsShCatalogPage(
      { page: 0, perPage: 500 },
      { oidcToken: "request-bound-oidc", fetchImpl: fetchImpl as typeof fetch },
    ).catch((value: unknown) => value);

    expect(skillsShSourceRetryAfterSeconds(error)).toBe(120);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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
        VERCEL_TARGET_ENV: "test",
        VITE_CLAWHUB_DEPLOY_ENV: "test",
        VITE_CONVEX_URL: "https://academic-chihuahua-392.convex.cloud",
        CLAWHUB_SKILLS_SH_TEST_LIVE_FETCH_ENABLED: "1",
      }),
    ).toMatchObject({
      allowed: false,
      environment: "test",
      reason: "skills.sh catalog rollout is disabled",
    });

    expect(
      getSkillsShCatalogTestSourcePolicy({
        CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
        VERCEL_ENV: "preview",
        CLAWHUB_SKILLS_SH_TEST_LIVE_FETCH_ENABLED: "1",
      }),
    ).toMatchObject({ allowed: false });

    expect(
      getSkillsShCatalogTestSourcePolicy({
        CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
        VERCEL_ENV: "test",
        VERCEL_TARGET_ENV: "test",
        VITE_CLAWHUB_DEPLOY_ENV: "test",
        VITE_CONVEX_URL: "https://academic-chihuahua-392.convex.cloud",
        CLAWHUB_SKILLS_SH_TEST_LIVE_FETCH_ENABLED: "1",
      }),
    ).toMatchObject({
      allowed: false,
      environment: "test",
      reason: "skills.sh live Test discovery requires the Vercel Preview runtime",
    });

    expect(
      getSkillsShCatalogTestSourcePolicy({
        CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
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
        CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "test",
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
          CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
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
          CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
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
      CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
      VERCEL_ENV: "preview",
      VERCEL_TARGET_ENV: "test",
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
