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
const options = { token, branch, apply: true, sleep: async () => undefined };
describe("Convex preview cleanup", () => {
  it("removes only the exact branch and retries; preserves prod/dev and other branches", async () => {
    const { request, remaining } = server();
    expect(await cleanupConvexPreviews({ ...options, fetch: request })).toEqual({
      selected: 3,
      deleted: 3,
      absent: 0,
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
    expect(run.env.CONVEX_PREVIEW_DEPLOY_KEY).toBe("${{ secrets.CONVEX_PREVIEW_DEPLOY_KEY }}");
    expect(run.env.PREVIEW_BRANCH).toBe(
      "${{ inputs.branch || github.event.pull_request.head.ref || github.event.ref }}",
    );
    expect(workflow.concurrency.group).toContain("inputs.branch ||");
    expect(run.run).not.toContain("${{");
    expect(run.run).toContain('"$PREVIEW_BRANCH"');
  });
});
