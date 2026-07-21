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

  it("resolves immutable owner ids through authenticated ClawHub GitHub headers", async () => {
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
      runQuery: vi.fn(async () => ({
        environment: "test",
        deploymentName: "academic-chihuahua-392",
        buildSha: "test-sha",
        control: {},
      })),
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
      fetches: 2,
      owners: [
        { owner: "anthropics", login: "anthropics", id: 76_263_028 },
        { owner: "nvidia", login: "nvidia", id: 1_728_152 },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("Bearer placeholder");
  });
});
