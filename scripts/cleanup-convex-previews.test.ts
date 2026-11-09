/* @vitest-environment node */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { cleanupConvexPreviews } from "./cleanup-convex-previews";

const token = "preview:amantus:clawdhub|fixture-not-a-secret";
const branch = "feature/demo";
const preview = (id: number, identifier: string) => ({
  id,
  name: "animal-" + id,
  projectId: 1479485,
  deploymentType: "preview",
  kind: "cloud",
  isDefault: false,
  previewIdentifier: identifier,
  reference: "preview/" + identifier,
});
const deployment = (id: number, identifier: string) => ({
  ...preview(id, identifier),
  name: "animal-" + id,
});
const inventory = [
  deployment(1, branch + "-vercel"),
  deployment(2, branch + "-vercel-retry-2"),
  deployment(3, branch + "-vercel-retry-3"),
  deployment(4, branch + "-other-vercel"),
  { ...deployment(5, branch + "-vercel"), deploymentType: "prod", isDefault: true },
  { ...deployment(6, branch + "-vercel"), deploymentType: "dev", isDefault: true },
];
function server(items = inventory) {
  const remaining = new Map(items.map((d) => [d.name, d]));
  const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/v1/projects/1479485/list_deployments")
      return Response.json([...remaining.values()]);
    const name = path.split("/")[3];
    const item = remaining.get(name);
    if (!item) return new Response(null, { status: 404 });
    if (init?.method === "POST") {
      remaining.delete(name);
      return new Response(null);
    }
    return Response.json(item);
  });
  return { request, remaining };
}
const openPr = (ref: string) => ({ state: "open", head: { ref } });
const options = {
  token,
  githubToken: "github-fixture-not-a-secret",
  githubFetch: vi.fn(async () => Response.json([])),
  branch,
  apply: true,
  sleep: async () => undefined,
};
describe("Convex preview cleanup", () => {
  it("preserves another open branch's Vercel preview when its raw-name branch closes", async () => {
    const { request, remaining } = server([inventory[0]]);
    const result = await cleanupConvexPreviews({
      ...options,
      branch: "feature/demo-vercel",
      githubFetch: async () => Response.json([openPr("feature/demo")]),
      fetch: request,
    });
    expect(result).toMatchObject({ deleted: 0, preserved: 1 });
    expect(remaining.size).toBe(1);
    expect(request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it.each(["feature/demo", "feature/demo-vercel", "feature/demo-vercel-retry-2"])(
    "preserves the raw/Vercel/retry claim %s of any open branch, including all-scope cleanup",
    async (identifier) => {
      const { request, remaining } = server([deployment(1, identifier)]);
      expect(
        await cleanupConvexPreviews({
          ...options,
          branch: undefined,
          all: true,
          githubFetch: async () => Response.json([openPr(branch)]),
          fetch: request,
        }),
      ).toMatchObject({ deleted: 0, preserved: 1 });
      expect(remaining.size).toBe(1);
    },
  );
  it("reopening during the guarded GET revokes permission before the first delete", async () => {
    const { request, remaining } = server([inventory[0]]);
    let reopened = false;
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (input, init) => {
      const response = await original(input, init);
      if (String(input).includes("/deployments/")) reopened = true;
      return response;
    });
    expect(
      await cleanupConvexPreviews({
        ...options,
        githubFetch: async () => Response.json(reopened ? [openPr(branch)] : []),
        fetch: request,
      }),
    ).toMatchObject({ selected: 1, deleted: 0, preserved: 1 });
    expect(remaining.size).toBe(1);
    expect(request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("rechecks authorization for each delete, preserving remaining retries if the branch reopens", async () => {
    const { request, remaining } = server();
    let reopened = false;
    expect(
      await cleanupConvexPreviews({
        ...options,
        githubFetch: async () => Response.json(reopened ? [openPr(branch)] : []),
        sleep: async () => {
          reopened = true;
        },
        fetch: request,
      }),
    ).toMatchObject({ selected: 3, deleted: 1, preserved: 2 });
    expect([...remaining.keys()]).toContain("animal-2");
    expect([...remaining.keys()]).toContain("animal-3");
    expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("finds colliding open branches beyond the first page", async () => {
    const { request, remaining } = server([inventory[0]]);
    const githubFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("state")).toBe("open");
      expect(url.searchParams.get("head")).toBeNull();
      return Response.json(
        url.searchParams.get("page") === "1"
          ? Array.from({ length: 100 }, (_, i) => openPr("unrelated/" + i))
          : [openPr(branch)],
      );
    });
    expect(
      await cleanupConvexPreviews({
        ...options,
        branch: "feature/demo-vercel",
        githubFetch,
        fetch: request,
      }),
    ).toMatchObject({ deleted: 0, preserved: 1 });
    expect(githubFetch).toHaveBeenCalledTimes(2);
    expect(remaining.size).toBe(1);
  });
  it("paginates again at the deletion boundary, not just during initial selection", async () => {
    const { request, remaining } = server([inventory[0]]);
    let reads = 0;
    const githubFetch = vi.fn(async (input: string | URL | Request) => {
      const page = new URL(String(input)).searchParams.get("page");
      if (page === "1") {
        reads += 1;
        return Response.json(Array.from({ length: 100 }, (_, i) => openPr("unrelated/" + i)));
      }
      return Response.json(reads > 1 ? [openPr(branch)] : []);
    });
    expect(await cleanupConvexPreviews({ ...options, githubFetch, fetch: request })).toMatchObject({
      deleted: 0,
      preserved: 1,
    });
    expect(githubFetch).toHaveBeenCalledTimes(4);
    expect(remaining.size).toBe(1);
  });
  it.each(["http", "network", "json", "shape", "head", "state", "later-page"])(
    "fails closed on GitHub %s failure immediately before deletion",
    async (failure) => {
      const { request, remaining } = server([inventory[0]]);
      let reads = 0;
      const githubFetch = vi.fn(async (input: string | URL | Request) => {
        reads += 1;
        if (reads === 1) return Response.json([]);
        if (failure === "http") return new Response("private server body", { status: 403 });
        if (failure === "network") throw new Error("Network unavailable");
        if (failure === "json") return new Response("private server body: not json");
        if (failure === "shape") return Response.json({ items: [] });
        if (failure === "head") return Response.json([{ state: "open", head: {} }]);
        if (failure === "state") return Response.json([{ ...openPr(branch), state: "closed" }]);
        if (new URL(String(input)).searchParams.get("page") === "1")
          return Response.json(Array.from({ length: 100 }, (_, i) => openPr("other/" + i)));
        return new Response("private server body", { status: 500 });
      });
      await expect(
        cleanupConvexPreviews({ ...options, githubFetch, fetch: request }),
      ).rejects.toThrow(failure === "json" ? "Invalid GitHub open-PR response" : undefined);
      expect(remaining.size).toBe(1);
      expect(request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    },
  );
  it("requires GitHub authorization before contacting either service", async () => {
    const request = vi.fn();
    await expect(
      cleanupConvexPreviews({ ...options, githubToken: "", fetch: request }),
    ).rejects.toThrow("A GitHub read token is required");
    expect(request).not.toHaveBeenCalled();
  });
  it("removes only the exact branch and retries; preserves prod/dev and other branches", async () => {
    const { request, remaining } = server();
    expect(await cleanupConvexPreviews({ ...options, fetch: request })).toEqual({
      selected: 3,
      deleted: 3,
      absent: 0,
      preserved: 0,
      dryRun: false,
    });
    expect([...remaining.values()].map((d) => d.id)).toEqual([4, 5, 6]);
    expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(3);
  });
  it("is dry-run by default and never makes a mutation", async () => {
    const { request } = server();
    expect(await cleanupConvexPreviews({ ...options, apply: false, fetch: request })).toMatchObject(
      { selected: 3, deleted: 0, dryRun: true },
    );
    expect(request).toHaveBeenCalledOnce();
  });
  it("can explicitly clear all previews without touching prod/dev", async () => {
    const { request, remaining } = server();
    await cleanupConvexPreviews({ ...options, branch: undefined, all: true, fetch: request });
    expect([...remaining.values()].map((d) => d.id)).toEqual([5, 6]);
  });
  it("is idempotent when the previews are already absent", async () => {
    const { request } = server([]);
    expect(await cleanupConvexPreviews({ ...options, fetch: request })).toMatchObject({
      selected: 0,
      deleted: 0,
    });
  });
  it.each(["", "prod:animal-1|fixture", "dev:animal-1|fixture"])(
    "refuses non-preview credential %s",
    async (value) => {
      const request = vi.fn();
      await expect(
        cleanupConvexPreviews({ ...options, token: value, fetch: request }),
      ).rejects.toThrow(/preview deploy key/i);
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("requires exactly one explicit scope", async () => {
    const request = vi.fn();
    for (const scope of [{ branch: undefined }, { all: true }]) {
      await expect(cleanupConvexPreviews({ ...options, ...scope, fetch: request })).rejects.toThrow(
        /scope/i,
      );
    }
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects a changed target before deletion", async () => {
    const { request } = server();
    request.mockImplementationOnce(async () => Response.json(inventory));
    request.mockImplementationOnce(async () =>
      Response.json({ ...inventory[0], deploymentType: "prod" }),
    );
    await expect(cleanupConvexPreviews({ ...options, fetch: request })).rejects.toThrow(/changed/i);
    expect(request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("uses stable reference identity when the single-deployment API omits previewIdentifier", async () => {
    const { request } = server();
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (input, init) => {
      const response = await original(input, init);
      if (String(input).includes("/deployments/") && init?.method === "GET" && response.ok) {
        return Response.json({ ...(await response.json()), previewIdentifier: null });
      }
      return response;
    });
    expect(await cleanupConvexPreviews({ ...options, fetch: request })).toMatchObject({
      deleted: 3,
    });
  });
  it("rejects a target whose stable reference changed", async () => {
    const { request } = server();
    request.mockImplementationOnce(async () => Response.json(inventory));
    request.mockImplementationOnce(async () =>
      Response.json({ ...inventory[0], reference: "production" }),
    );
    await expect(cleanupConvexPreviews({ ...options, fetch: request })).rejects.toThrow(/changed/i);
    expect(request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("fails closed on a wrong project or malformed list", async () => {
    for (const body of [{ items: [] }, [{ ...inventory[0], projectId: 1 }]]) {
      const request = vi.fn(async () => Response.json(body));
      await expect(cleanupConvexPreviews({ ...options, fetch: request })).rejects.toThrow();
      expect(request).toHaveBeenCalledOnce();
    }
  });
  it("does not blindly retry a failed delete or expose response bodies", async () => {
    const { request } = server();
    request.mockImplementationOnce(async () => Response.json(inventory));
    request.mockImplementationOnce(async () => Response.json(inventory[0]));
    request.mockImplementationOnce(async () => new Response("secret server body", { status: 429 }));
    await expect(cleanupConvexPreviews({ ...options, fetch: request })).rejects.toThrow(
      "Convex management request failed (429)",
    );
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("handles a target disappearing between list and guarded read", async () => {
    const { request } = server([]);
    request.mockImplementationOnce(async () => Response.json([inventory[0]]));
    expect(await cleanupConvexPreviews({ ...options, fetch: request })).toMatchObject({
      deleted: 0,
      absent: 1,
    });
  });
});
describe("preview cleanup workflow trust boundary", () => {
  it("uses closed PR events and only trusted main code with a preview-only secret", () => {
    const workflow = parse(readFileSync(".github/workflows/cleanup-previews.yml", "utf8"));
    expect(workflow.on.pull_request_target.types).toEqual(["closed"]);
    expect(workflow.permissions).toEqual({ contents: "read", "pull-requests": "read" });
    const job = workflow.jobs.cleanup;
    const checkout = job.steps.find((step: { uses?: string }) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(checkout.with.ref).toBe("main");
    expect(checkout.with["persist-credentials"]).toBe(false);
    const run = job.steps.find(
      (step: { name?: string }) => step.name === "Remove branch previews and retry leftovers",
    );
    expect(run.env.GH_TOKEN).toBe("${{ github.token }}");
    expect(job.if).toContain("github.ref == 'refs/heads/main'");
    expect(run.run).toContain("bun scripts/cleanup-convex-previews.ts");
    expect(run.run).not.toContain("gh api");
    expect(run.env.CONVEX_PREVIEW_DEPLOY_KEY).toBe("${{ secrets.CONVEX_PREVIEW_DEPLOY_KEY }}");
    expect(run.env.PREVIEW_BRANCH).toBe(
      "${{ inputs.branch || github.event.pull_request.head.ref || github.event.ref }}",
    );
    expect(workflow.concurrency.group).toContain("inputs.branch ||");
    expect(run.run).not.toContain("${{");
    expect(run.run).toContain('"$PREVIEW_BRANCH"');
  });
});
