/* @vitest-environment node */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/httpRateLimit", () => ({
  applyRateLimit: vi.fn(async () => ({ ok: true, headers: {} })),
  markRateLimitApplied: vi.fn(),
}));

vi.mock("../lib/githubAuth", () => ({
  buildGitHubApiHeaders: vi.fn(async () => ({ Authorization: "Bearer placeholder" })),
}));

vi.mock("../lib/githubSkillSync", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/githubSkillSync")>();
  return {
    ...original,
    computeGitHubSkillFolderContentHash: vi.fn(original.computeGitHubSkillFolderContentHash),
  };
});

vi.mock("./shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("./shared")>();
  return {
    ...original,
    requireApiTokenUserOrResponse: vi.fn(),
    requireAdminOrResponse: vi.fn(),
  };
});

const { requireAdminOrResponse, requireApiTokenUserOrResponse } = await import("./shared");
const { buildGitHubApiHeaders } = await import("../lib/githubAuth");
const { computeGitHubSkillFolderContentHash } = await import("../lib/githubSkillSync");
const {
  skillsShCatalogPublicV1Handler,
  skillsShCatalogTestV1Handler,
  verifyControlledCanaryGitHubSource,
} = await import("./skillsShCatalogV1");

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function artifact(externalId: string, content: string) {
  const fileHash = sha256(content);
  return {
    externalId,
    artifactContentHash: sha256(`SKILL.md\0${fileHash}\n`),
    files: [
      {
        path: "SKILL.md",
        contentBase64: Buffer.from(content).toString("base64"),
        sha256: fileHash,
        contentType: "text/markdown",
      },
    ],
  };
}

describe("skills.sh catalog Test HTTP API", () => {
  beforeEach(() => {
    vi.mocked(requireApiTokenUserOrResponse).mockResolvedValue({
      ok: true,
      user: { handle: "catalog-operator" },
      userId: "users:operator",
    } as never);
    vi.mocked(requireAdminOrResponse).mockReturnValue({ ok: true } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deletes uploaded files for admissions the mutation skips", async () => {
    const storedIds = ["storage:linked", "storage:skipped"];
    const store = vi.fn(async () => storedIds.shift()!);
    const deleteStorage = vi.fn(async () => undefined);
    const runAction = vi.fn(async (_ref, args: Record<string, unknown>) => {
      expect(args).toMatchObject({
        externalIds: ["nvidia/skills/aiq-deploy", "nvidia/skills/aiq-toolkit"],
      });
      return {
        requested: 2,
        admitted: 1,
        skipped: 1,
        admittedExternalIds: ["nvidia/skills/aiq-deploy"],
      };
    });
    const ctx = {
      runQuery: vi.fn(async () => ({
        environment: "test",
        deploymentName: "academic-chihuahua-392",
        buildSha: "test-sha",
        control: {},
      })),
      runAction,
      storage: {
        store,
        delete: deleteStorage,
      },
    } as never;
    const request = new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
      method: "POST",
      body: JSON.stringify({
        operation: "admit",
        runId: "skillsShCatalogRuns:test",
        externalIds: ["nvidia/skills/aiq-deploy", "nvidia/skills/aiq-toolkit"],
        artifacts: [
          artifact("nvidia/skills/aiq-deploy", "# Linked"),
          artifact("nvidia/skills/aiq-toolkit", "# Skipped"),
        ],
      }),
    });

    const response = await skillsShCatalogTestV1Handler(ctx, request);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ admitted: 1, skipped: 1 });
    expect(store).toHaveBeenCalledTimes(2);
    expect(deleteStorage).toHaveBeenCalledTimes(1);
    expect(deleteStorage).toHaveBeenCalledWith("storage:skipped");
  });

  it("does not report a committed admission as failed when skipped-file cleanup fails", async () => {
    const storedIds = ["storage:linked", "storage:skipped"];
    const store = vi.fn(async () => storedIds.shift()!);
    const deleteStorage = vi.fn(async () => {
      throw new Error("temporary storage cleanup outage");
    });
    const ctx = {
      runQuery: vi.fn(async () => ({
        environment: "test",
        deploymentName: "academic-chihuahua-392",
        buildSha: "test-sha",
        control: {},
      })),
      runAction: vi.fn(async () => ({
        requested: 2,
        admitted: 1,
        skipped: 1,
        admittedExternalIds: ["nvidia/skills/aiq-deploy"],
      })),
      storage: {
        store,
        delete: deleteStorage,
      },
    } as never;
    const request = new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
      method: "POST",
      body: JSON.stringify({
        operation: "admit",
        runId: "skillsShCatalogRuns:test",
        externalIds: ["nvidia/skills/aiq-deploy", "nvidia/skills/aiq-toolkit"],
        artifacts: [
          artifact("nvidia/skills/aiq-deploy", "# Linked"),
          artifact("nvidia/skills/aiq-toolkit", "# Skipped"),
        ],
      }),
    });

    const response = await skillsShCatalogTestV1Handler(ctx, request);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ admitted: 1, skipped: 1 });
    expect(deleteStorage).toHaveBeenCalledWith("storage:skipped");
  });

  it("reuses authenticated staging-live owner ids without a GitHub fetch", async () => {
    const githubFetch = vi.fn();
    vi.stubGlobal("fetch", githubFetch);
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          environment: "test",
          deploymentName: "academic-chihuahua-392",
          buildSha: "test-sha",
          control: {},
        })
        .mockResolvedValueOnce({
          provenance: "stored-authenticated-staging-live",
          owners: [
            { owner: "anthropics", login: "anthropics", id: 76_263_028 },
            { owner: "nvidia", login: "nvidia", id: 1_728_152 },
          ],
          missingOwners: [],
        }),
    } as never;
    const request = new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
      method: "POST",
      body: JSON.stringify({
        operation: "resolve-owners",
        owners: ["nvidia", "anthropics"],
      }),
    });

    const response = await skillsShCatalogTestV1Handler(ctx, request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authentication: "clawhub-github-authenticated",
      provenance: "stored-authenticated-staging-live",
      fetches: 0,
      reused: 2,
      owners: [
        { owner: "anthropics", login: "anthropics", id: 76_263_028 },
        { owner: "nvidia", login: "nvidia", id: 1_728_152 },
      ],
    });
    expect(githubFetch).not.toHaveBeenCalled();
    expect(buildGitHubApiHeaders).not.toHaveBeenCalled();
  });

  it("routes mirror batches through the scanless mirror mutation", async () => {
    const runMutation = vi.fn(async (_ref, args: Record<string, unknown>) => ({
      status: "running",
      page: args.page,
      offset: 1,
    }));
    const ctx = {
      runQuery: vi.fn(async () => ({
        environment: "test",
        deploymentName: "academic-chihuahua-392",
        buildSha: "test-sha",
        control: {},
      })),
      runMutation,
    } as never;
    const request = new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
      method: "POST",
      body: JSON.stringify({
        operation: "mirror-batch",
        runId: "skillsShMirrorRuns:test",
        leaseToken: "lease:test",
        page: 0,
        offset: 0,
        pageLength: 500,
        hasMore: true,
        sourceTotal: 9_571,
        sourceRequests: 2,
        sourceBytes: 1_024,
        rows: [{ externalId: "vercel-labs/skills/find-skills" }],
      }),
    });

    const response = await skillsShCatalogTestV1Handler(ctx, request);

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: "skillsShMirrorRuns:test",
        leaseToken: "lease:test",
        page: 0,
        offset: 0,
        sourceTotal: 9_571,
      }),
    );
  });

  it("stores and summarizes immutable mirror source pages", async () => {
    const staging = {
      environment: "test",
      deploymentName: "academic-chihuahua-392",
      buildSha: "test-sha",
      control: {},
    };
    const rows = [
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
    ];
    const runMutation = vi.fn(async () => ({ stored: true, page: 0, rows: 1 }));
    const storeCtx = { runQuery: vi.fn(async () => staging), runMutation } as never;
    const storeResponse = await skillsShCatalogTestV1Handler(
      storeCtx,
      new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
        method: "POST",
        body: JSON.stringify({
          operation: "mirror-source-page-store",
          snapshotHash: "a".repeat(64),
          page: 0,
          sourceTotal: 1,
          pageLength: 1,
          hasMore: false,
          identityHash: "b".repeat(64),
          contentHash: "c".repeat(64),
          sourceBytes: 512,
          serializedBytes: 768,
          rows,
        }),
      }),
    );

    expect(storeResponse.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        snapshotHash: "a".repeat(64),
        page: 0,
        rows,
      }),
    );

    const summary = {
      snapshotHash: "a".repeat(64),
      pageDocuments: 1,
      rows: 1,
      sourceBytes: 512,
      serializedBytes: 768,
    };
    const runQuery = vi.fn().mockResolvedValueOnce(staging).mockResolvedValueOnce(summary);
    const summaryResponse = await skillsShCatalogTestV1Handler(
      { runQuery } as never,
      new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
        method: "POST",
        body: JSON.stringify({
          operation: "mirror-source-summary",
          snapshotHash: "a".repeat(64),
        }),
      }),
    );

    expect(summaryResponse.status).toBe(200);
    expect(await summaryResponse.json()).toEqual(summary);
    expect(runQuery).toHaveBeenCalledTimes(2);
  });

  it("routes guarded mirror batch lease claims and releases", async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        runId: "skillsShMirrorRuns:test",
        page: 3,
        offset: 50,
        leaseToken: "lease:test",
        leaseExpiresAt: Date.now() + 300_000,
      })
      .mockResolvedValueOnce({ released: true });
    const ctx = {
      runQuery: vi.fn(async () => ({
        environment: "test",
        deploymentName: "academic-chihuahua-392",
        buildSha: "test-sha",
        control: {},
      })),
      runMutation,
    } as never;

    for (const operation of ["mirror-batch-claim", "mirror-batch-release"] as const) {
      const response = await skillsShCatalogTestV1Handler(
        ctx,
        new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
          method: "POST",
          body: JSON.stringify({
            operation,
            runId: "skillsShMirrorRuns:test",
            page: 3,
            offset: 50,
            leaseToken: "lease:test",
          }),
        }),
      );
      expect(response.status).toBe(200);
    }

    expect(runMutation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        runId: "skillsShMirrorRuns:test",
        page: 3,
        offset: 50,
        leaseToken: "lease:test",
      }),
    );
    expect(runMutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        runId: "skillsShMirrorRuns:test",
        page: 3,
        offset: 50,
        leaseToken: "lease:test",
      }),
    );
  });

  it("reads one mirror run for source-fetch preflight", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        environment: "test",
        deploymentName: "academic-chihuahua-392",
        buildSha: "test-sha",
        control: {},
      })
      .mockResolvedValueOnce({
        runId: "skillsShMirrorRuns:test",
        status: "paused",
        page: 3,
        offset: 50,
      });
    const ctx = { runQuery } as never;
    const request = new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
      method: "POST",
      body: JSON.stringify({
        operation: "mirror-run",
        runId: "skillsShMirrorRuns:test",
      }),
    });

    const response = await skillsShCatalogTestV1Handler(ctx, request);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "paused",
      page: 3,
      offset: 50,
    });
    expect(runQuery).toHaveBeenCalledTimes(2);
  });

  it("cancels one stale active mirror run with explicit confirmation", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      environment: "test",
      deploymentName: "academic-chihuahua-392",
      buildSha: "test-sha",
      control: {},
    });
    const runMutation = vi.fn().mockResolvedValue({
      runId: "skillsShMirrorRuns:stale",
      status: "canceled",
    });
    const ctx = { runQuery, runMutation } as never;
    const request = new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
      method: "POST",
      body: JSON.stringify({
        operation: "mirror-cancel",
        runId: "skillsShMirrorRuns:stale",
        reason: "discard stale captured recovery",
        confirm: "cancel-skills-sh-mirror-test-run",
      }),
    });

    const response = await skillsShCatalogTestV1Handler(ctx, request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      runId: "skillsShMirrorRuns:stale",
      status: "canceled",
    });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: "skillsShMirrorRuns:stale",
        reason: "discard stale captured recovery",
        confirm: "cancel-skills-sh-mirror-test-run",
      }),
    );
  });

  it("reads bounded mirror conflicts for an exact completed run", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        environment: "test",
        deploymentName: "academic-chihuahua-392",
        buildSha: "test-sha",
        control: {},
      })
      .mockResolvedValueOnce([
        {
          runId: "skillsShMirrorRuns:live",
          externalId: "larksuite/cli/lark-doc",
          kind: "source-quarantine",
        },
      ]);
    const ctx = { runQuery } as never;
    const response = await skillsShCatalogTestV1Handler(
      ctx,
      new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
        method: "POST",
        body: JSON.stringify({
          operation: "mirror-conflicts",
          runId: "skillsShMirrorRuns:live",
          limit: 50,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      conflicts: [
        {
          runId: "skillsShMirrorRuns:live",
          externalId: "larksuite/cli/lark-doc",
          kind: "source-quarantine",
        },
      ],
    });
    expect(runQuery).toHaveBeenCalledTimes(2);
  });

  it("reads bounded mirror classification reuse state", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        environment: "test",
        deploymentName: "academic-chihuahua-392",
        buildSha: "test-sha",
        control: {},
      })
      .mockResolvedValueOnce([
        {
          externalId: "patrick-erichsen/skills/html",
          inferredClassifierVersion: "taxonomy-prototype-v9",
        },
      ]);
    const ctx = { runQuery } as never;
    const response = await skillsShCatalogTestV1Handler(
      ctx,
      new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
        method: "POST",
        body: JSON.stringify({
          operation: "mirror-classification-states",
          externalIds: ["patrick-erichsen/skills/html"],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      states: [{ externalId: "patrick-erichsen/skills/html" }],
    });
    expect(runQuery).toHaveBeenCalledTimes(2);
  });

  it("reads a bounded mirror facet proof page", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        environment: "test",
        deploymentName: "academic-chihuahua-392",
        buildSha: "test-sha",
        control: {},
      })
      .mockResolvedValueOnce({
        page: [{ kind: "category", term: "development" }],
        isDone: true,
        continueCursor: "",
      });
    const ctx = { runQuery } as never;
    const response = await skillsShCatalogTestV1Handler(
      ctx,
      new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
        method: "POST",
        body: JSON.stringify({
          operation: "mirror-facet-page",
          cursor: null,
          limit: 500,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      page: [{ kind: "category", term: "development" }],
      isDone: true,
    });
  });

  it("reads bounded captured mirror rows for replay", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        environment: "test",
        deploymentName: "academic-chihuahua-392",
        buildSha: "test-sha",
        control: {},
      })
      .mockResolvedValueOnce([
        {
          digest: { externalId: "patrick-erichsen/skills/html", active: true },
          detail: null,
        },
      ]);
    const ctx = { runQuery } as never;
    const response = await skillsShCatalogTestV1Handler(
      ctx,
      new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
        method: "POST",
        body: JSON.stringify({
          operation: "mirror-replay-rows",
          externalIds: ["patrick-erichsen/skills/html"],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rows: [{ digest: { externalId: "patrick-erichsen/skills/html" }, detail: null }],
    });
  });

  it("fetches only owners missing from authenticated staging-live state", async () => {
    const githubFetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer placeholder" });
      const owner = url.split("/").at(-1)!;
      return new Response(
        JSON.stringify({
          id: owner === "nvidia" ? 1_728_152 : 76_263_028,
          login: owner,
        }),
      );
    });
    vi.stubGlobal("fetch", githubFetch);
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          environment: "test",
          deploymentName: "academic-chihuahua-392",
          buildSha: "test-sha",
          control: {},
        })
        .mockResolvedValueOnce({
          provenance: "stored-authenticated-staging-live",
          owners: [{ owner: "nvidia", login: "nvidia", id: 1_728_152 }],
          missingOwners: ["anthropics"],
        })
        .mockResolvedValueOnce({
          provenance: "stored-authenticated-staging-live-assignment-check",
          checked: 1,
        }),
    } as never;
    const request = new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
      method: "POST",
      body: JSON.stringify({
        operation: "resolve-owners",
        owners: ["nvidia", "anthropics"],
      }),
    });

    const response = await skillsShCatalogTestV1Handler(ctx, request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      authentication: "clawhub-github-authenticated",
      provenance: "stored-authenticated-staging-live+live-github",
      fetches: 1,
      reused: 1,
      owners: [
        { owner: "anthropics", login: "anthropics", id: 76_263_028 },
        { owner: "nvidia", login: "nvidia", id: 1_728_152 },
      ],
    });
    expect(githubFetch).toHaveBeenCalledTimes(1);
    expect(buildGitHubApiHeaders).toHaveBeenCalledWith({
      userAgent: "clawhub/skills-sh-catalog-test",
      allowAnonymous: false,
      useGitHubApp: false,
    });
    expect(JSON.stringify(body)).not.toContain("Bearer placeholder");
  });

  it("reports only non-secret HTTP status when authenticated owner lookup fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("token=secret-response-body", { status: 404 })),
    );
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          environment: "test",
          deploymentName: "academic-chihuahua-392",
          buildSha: "test-sha",
          control: {},
        })
        .mockResolvedValueOnce({
          provenance: "stored-authenticated-staging-live",
          owners: [],
          missingOwners: ["neondatabase"],
        }),
    } as never;
    const request = new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
      method: "POST",
      body: JSON.stringify({
        operation: "resolve-owners",
        owners: ["neondatabase"],
      }),
    });

    const response = await skillsShCatalogTestV1Handler(ctx, request);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toBe("Authenticated GitHub owner lookup failed with HTTP 404: neondatabase");
    expect(body).not.toContain("secret-response-body");
    expect(body).not.toContain("Bearer placeholder");
  });

  it("fails closed when a new owner lacks authenticated GitHub access", async () => {
    vi.mocked(buildGitHubApiHeaders).mockRejectedValueOnce(
      new Error("GitHub API authentication is not configured"),
    );
    const githubFetch = vi.fn();
    vi.stubGlobal("fetch", githubFetch);
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          environment: "test",
          deploymentName: "academic-chihuahua-392",
          buildSha: "test-sha",
          control: {},
        })
        .mockResolvedValueOnce({
          provenance: "stored-authenticated-staging-live",
          owners: [],
          missingOwners: ["new-owner"],
        }),
    } as never;
    const request = new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
      method: "POST",
      body: JSON.stringify({
        operation: "resolve-owners",
        owners: ["new-owner"],
      }),
    });

    const response = await skillsShCatalogTestV1Handler(ctx, request);

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("GitHub API authentication is not configured");
    expect(githubFetch).not.toHaveBeenCalled();
  });

  it("rejects a fetched owner id already assigned to another login", async () => {
    const githubFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 1_728_152, login: "renamed-nvidia" }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", githubFetch);
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          environment: "test",
          deploymentName: "academic-chihuahua-392",
          buildSha: "test-sha",
          control: {},
        })
        .mockResolvedValueOnce({
          provenance: "stored-authenticated-staging-live",
          owners: [],
          missingOwners: ["renamed-nvidia"],
        })
        .mockRejectedValueOnce(
          new Error("Authenticated GitHub owner id 1728152 is already assigned to another owner"),
        ),
    } as never;
    const request = new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
      method: "POST",
      body: JSON.stringify({
        operation: "resolve-owners",
        owners: ["renamed-nvidia"],
      }),
    });

    const response = await skillsShCatalogTestV1Handler(ctx, request);

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "Authenticated GitHub owner id 1728152 is already assigned to another owner",
    );
    expect(githubFetch).toHaveBeenCalledTimes(1);
  });

  it("verifies the controlled canary against immutable public GitHub content", async () => {
    const skillMarkdown = "# HTML Artifact Chooser\n";
    const fileHash = sha256(skillMarkdown);
    const contentHash = sha256(`SKILL.md\0${Buffer.byteLength(skillMarkdown)}\0${fileHash}`);
    const githubFetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer placeholder" });
      if (url.endsWith("/repos/patrick-erichsen/skills")) {
        return new Response(
          JSON.stringify({
            private: false,
            full_name: "Patrick-Erichsen/skills",
            owner: { id: 20_157_849, login: "Patrick-Erichsen" },
          }),
        );
      }
      if (url.includes("/git/commits/")) {
        return new Response(
          JSON.stringify({
            sha: "050daba89f6b6636470add5cb300aac46a412cf8",
            tree: { sha: "tree-sha" },
          }),
        );
      }
      if (url.endsWith("/git/trees/tree-sha?recursive=1")) {
        return new Response(
          JSON.stringify({
            truncated: false,
            tree: [
              {
                path: "skills/html/SKILL.md",
                type: "blob",
                sha: "blob-sha",
                size: Buffer.byteLength(skillMarkdown),
              },
            ],
          }),
        );
      }
      if (url.endsWith("/git/blobs/blob-sha")) {
        return new Response(
          JSON.stringify({
            encoding: "base64",
            content: Buffer.from(skillMarkdown).toString("base64"),
          }),
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", githubFetch);
    const proof = await verifyControlledCanaryGitHubSource({
      fetchImpl: githubFetch as typeof fetch,
      checkedAt: "2026-07-22T05:00:00.000Z",
      expected: {
        externalId: "patrick-erichsen/skills/html",
        githubOwnerId: 20_157_849,
        owner: "patrick-erichsen",
        repo: "skills",
        slug: "html",
        displayName: "HTML Artifact Chooser",
        sourceUrl: "https://www.skills.sh/patrick-erichsen/skills/html",
        githubRepoUrl: "https://github.com/Patrick-Erichsen/skills",
        githubPath: "skills/html",
        githubCommit: "050daba89f6b6636470add5cb300aac46a412cf8",
        githubContentHash: contentHash,
        sourceContentHash: contentHash,
        installs: 0,
      },
    });

    expect(proof).toMatchObject({
      authentication: "clawhub-github-authenticated",
      fixtureId: "patrick-html-canary-v1",
      externalId: "patrick-erichsen/skills/html",
      githubOwnerId: 20_157_849,
      githubPath: "skills/html",
      githubCommit: "050daba89f6b6636470add5cb300aac46a412cf8",
      githubContentHash: contentHash,
      githubFetches: 4,
    });
    expect(githubFetch).toHaveBeenCalledTimes(4);
    expect(buildGitHubApiHeaders).toHaveBeenCalledWith({
      userAgent: "clawhub/skills-sh-catalog-canary",
      allowAnonymous: false,
      useGitHubApp: false,
    });
  });

  it("passes only server-fetched GitHub verification when starting the controlled canary", async () => {
    const expectedContentHash = "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f";
    vi.mocked(computeGitHubSkillFolderContentHash).mockResolvedValueOnce(expectedContentHash);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/repos/patrick-erichsen/skills")) {
          return new Response(
            JSON.stringify({
              private: false,
              full_name: "Patrick-Erichsen/skills",
              owner: { id: 20_157_849, login: "Patrick-Erichsen" },
            }),
          );
        }
        if (url.includes("/git/commits/")) {
          return new Response(
            JSON.stringify({
              sha: "050daba89f6b6636470add5cb300aac46a412cf8",
              tree: { sha: "tree-sha" },
            }),
          );
        }
        if (url.endsWith("/git/trees/tree-sha?recursive=1")) {
          return new Response(
            JSON.stringify({
              truncated: false,
              tree: [
                {
                  path: "skills/html/SKILL.md",
                  type: "blob",
                  sha: "blob-sha",
                },
              ],
            }),
          );
        }
        if (url.endsWith("/git/blobs/blob-sha")) {
          return new Response(
            JSON.stringify({
              encoding: "base64",
              content: Buffer.from("# Server-fetched content\n").toString("base64"),
            }),
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );
    const runMutation = vi.fn(async (_ref: unknown, _args: Record<string, unknown>) => ({
      runId: "skillsShCatalogRuns:canary",
    }));
    const ctx = {
      runQuery: vi.fn(async () => ({
        environment: "test",
        deploymentName: "academic-chihuahua-392",
        buildSha: "test-sha",
        control: {},
      })),
      runMutation,
    } as never;
    const request = new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
      method: "POST",
      body: JSON.stringify({
        operation: "start-canary",
        reason: "CLAW-557 hidden metadata canary",
        sourceVerification: {
          githubOwnerId: 1,
          githubCommit: "client-controlled",
          githubContentHash: "client-controlled",
          githubCheckedAt: "client-controlled",
          githubFetches: 99_999,
        },
      }),
    });

    const response = await skillsShCatalogTestV1Handler(ctx, request);

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledOnce();
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      fixtureId: "patrick-html-canary-v1",
      actor: "catalog-operator",
      reason: "CLAW-557 hidden metadata canary",
      sourceVerification: {
        githubOwnerId: 20_157_849,
        githubCommit: "050daba89f6b6636470add5cb300aac46a412cf8",
        githubContentHash: expectedContentHash,
        githubCheckedAt: expect.any(String),
        githubFetches: 4,
      },
    });
    expect(JSON.stringify(runMutation.mock.calls[0]?.[1])).not.toContain("client-controlled");
  });

  it.each([
    {
      operation: "start-canary-scan",
      input: { reason: "scan the exact canary" },
      expected: {
        actor: "catalog-operator",
        reason: "scan the exact canary",
      },
    },
    {
      operation: "set-publication",
      input: {
        enabled: true,
        reason: "enable exact-version publication",
        confirm: "set-skills-sh-test-publication",
      },
      expected: {
        enabled: true,
        actor: "catalog-operator",
        reason: "enable exact-version publication",
        confirm: "set-skills-sh-test-publication",
      },
    },
    {
      operation: "set-pause",
      input: {
        paused: true,
        reason: "pause catalog-only work",
        confirm: "set-skills-sh-test-pause",
      },
      expected: {
        paused: true,
        actor: "catalog-operator",
        reason: "pause catalog-only work",
        confirm: "set-skills-sh-test-pause",
      },
    },
    {
      operation: "rollback-publication",
      input: {
        externalId: "patrick-erichsen/skills/html",
        attemptId: "skillsShCatalogScanAttempts:canary",
        reason: "hide the exact published attempt",
        confirm: "rollback-skills-sh-test-publication",
      },
      expected: {
        externalId: "patrick-erichsen/skills/html",
        attemptId: "skillsShCatalogScanAttempts:canary",
        actor: "catalog-operator",
        reason: "hide the exact published attempt",
        confirm: "rollback-skills-sh-test-publication",
      },
    },
  ])("forwards the $operation operator command", async ({ operation, input, expected }) => {
    const runMutation = vi.fn(async (_ref: unknown, _args: unknown) => ({ ok: true }));
    const ctx = {
      runQuery: vi.fn(async () => ({
        environment: "test",
        deploymentName: "academic-chihuahua-392",
        buildSha: "test-sha",
        control: {},
      })),
      runMutation,
    } as never;
    const request = new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
      method: "POST",
      body: JSON.stringify({ operation, ...input }),
    });

    const response = await skillsShCatalogTestV1Handler(ctx, request);

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledOnce();
    expect(runMutation.mock.calls[0]?.[1]).toEqual(expected);
  });

  it.each([
    { operation: "set-publication", field: "enabled", value: undefined },
    { operation: "set-publication", field: "enabled", value: "true" },
    { operation: "set-publication", field: "enabled", value: null },
    { operation: "set-pause", field: "paused", value: undefined },
    { operation: "set-pause", field: "paused", value: "false" },
    { operation: "set-pause", field: "paused", value: 0 },
  ])("rejects malformed $operation $field controls", async ({ operation, field, value }) => {
    const runMutation = vi.fn(async (_ref: unknown, _args: unknown) => ({ ok: true }));
    const ctx = {
      runQuery: vi.fn(async () => ({
        environment: "test",
        deploymentName: "academic-chihuahua-392",
        buildSha: "test-sha",
        control: {},
      })),
      runMutation,
    } as never;
    const request = new Request("https://academic-chihuahua-392.convex.site/api/v1/ops", {
      method: "POST",
      body: JSON.stringify({
        operation,
        ...(value === undefined ? {} : { [field]: value }),
        reason: "exercise strict operator input validation",
        confirm:
          operation === "set-publication"
            ? "set-skills-sh-test-publication"
            : "set-skills-sh-test-pause",
      }),
    });

    const response = await skillsShCatalogTestV1Handler(ctx, request);

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(`${field} is required`);
    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe("skills.sh public HTTP API", () => {
  const publicEntry = {
    ref: "skills-sh/patrick-erichsen/skills/html",
    route: "/skills-sh/patrick-erichsen/skills/html",
    displayName: "HTML Artifact Chooser",
    security: {
      verdict: "clean",
      source: "clawhub",
      attemptId: "skillsShCatalogScanAttempts:canary",
    },
    install: {
      ok: true,
      slug: "skills-sh/patrick-erichsen/skills/html",
      installKind: "github",
      github: {
        repo: "patrick-erichsen/skills",
        path: "skills/html",
        commit: "050daba89f6b6636470add5cb300aac46a412cf8",
        contentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
        sourceUrl:
          "https://github.com/patrick-erichsen/skills/tree/050daba89f6b6636470add5cb300aac46a412cf8/skills/html",
      },
    },
  };

  it("serves an approved slash detail route", async () => {
    const runQuery = vi.fn(async () => publicEntry);
    const ctx = { runQuery } as never;
    const response = await skillsShCatalogPublicV1Handler(
      ctx,
      new Request(
        "https://academic-chihuahua-392.convex.site/api/v1/skills-sh/patrick-erichsen/skills/html",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(publicEntry);
    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      owner: "patrick-erichsen",
      repo: "skills",
      slug: "html",
    });
  });

  it.each([
    "/api/v1/skills-sh:patrick-erichsen/skills/html/install",
    "/api/v1/skills-sh/patrick-erichsen/skills/html/extra",
    "/api/v1/skills-sh/patrick-erichsen/skills%3Ahtml/install",
    "/api/v1/skills-sh/patrick-erichsen/%/html/install",
  ])("rejects malformed or colon-form references at %s", async (path) => {
    const runQuery = vi.fn();
    const ctx = { runQuery } as never;
    const response = await skillsShCatalogPublicV1Handler(
      ctx,
      new Request(`https://academic-chihuahua-392.convex.site${path}`),
    );

    expect(response.status).toBe(404);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("returns 404 while the exact entry is not public", async () => {
    const ctx = { runQuery: vi.fn(async () => null) } as never;
    const response = await skillsShCatalogPublicV1Handler(
      ctx,
      new Request(
        "https://academic-chihuahua-392.convex.site/api/v1/skills-sh/patrick-erichsen/skills/html/install",
      ),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Skill not found");
  });
});
