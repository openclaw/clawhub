/* @vitest-environment node */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/httpRateLimit", () => ({
  applyRateLimit: vi.fn(async () => ({ ok: true, headers: {} })),
}));

vi.mock("../lib/githubAuth", () => ({
  buildGitHubApiHeaders: vi.fn(async () => ({ Authorization: "Bearer placeholder" })),
}));

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
const { skillsShCatalogTestV1Handler } = await import("./skillsShCatalogV1");

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
});
