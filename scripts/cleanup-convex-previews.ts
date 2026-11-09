#!/usr/bin/env bun

// ClawHub only. A preview key cannot delete production/developer deployments.
const PROJECT_ID = 1479485;
const API_URL = "https://api.convex.dev/v1";
type Deployment = {
  id: number;
  name: string;
  projectId: number;
  deploymentType: string;
  kind: string;
  isDefault: boolean;
  previewIdentifier: string | null;
  reference: string;
};
type Options = {
  token: string;
  branch?: string;
  all?: boolean;
  apply?: boolean;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export async function cleanupConvexPreviews({
  token,
  branch,
  all = false,
  apply = false,
  fetch: request = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: Options) {
  if (!token.trim().startsWith("preview:"))
    throw new Error("A Convex preview deploy key is required");
  if (Boolean(branch) === all) throw new Error("Select exactly one cleanup scope: branch or all");
  if (branch && ["main", "test", "staging"].includes(branch))
    throw new Error("Permanent branches are not a cleanup scope");
  async function api(path: string, method = "GET", missingOk = false): Promise<unknown> {
    const response = await request(API_URL + path, {
      method,
      headers: { Authorization: "Bearer " + token.trim() },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404 && missingOk) return null;
    // Never log server response bodies: authorization responses can contain credentials.
    if (!response.ok) throw new Error("Convex management request failed (" + response.status + ")");
    return method === "GET" ? response.json() : null;
  }
  function deployment(value: unknown): Deployment {
    if (!value || typeof value !== "object") throw new Error("Invalid deployment response");
    const d = value as Deployment;
    if (
      d.projectId !== PROJECT_ID ||
      !Number.isSafeInteger(d.id) ||
      typeof d.name !== "string" ||
      !/^[a-z0-9-]+$/.test(d.name) ||
      typeof d.deploymentType !== "string" ||
      typeof d.isDefault !== "boolean" ||
      typeof d.reference !== "string" ||
      d.kind !== "cloud"
    ) {
      throw new Error("Unexpected project or malformed deployment response");
    }
    return d;
  }
  async function list() {
    const result = await api("/projects/" + PROJECT_ID + "/list_deployments");
    if (!Array.isArray(result)) throw new Error("Invalid deployment list");
    return result.map(deployment);
  }
  function selected(d: Deployment) {
    if (d.deploymentType !== "preview" || d.isDefault || typeof d.previewIdentifier !== "string")
      return false;
    if (all) return true;
    const identifier = d.previewIdentifier;
    const base = branch + "-vercel";
    return (
      identifier === branch ||
      identifier === base ||
      (identifier.startsWith(base + "-retry-") &&
        /^\d+$/.test(identifier.slice((base + "-retry-").length)))
    );
  }
  const before = await list();
  const targets = before.filter(selected);
  const result = { selected: targets.length, deleted: 0, absent: 0, dryRun: !apply };
  if (!apply || targets.length === 0) return result;
  for (const target of targets) {
    const value = await api("/deployments/" + target.name, "GET", true);
    if (value === null) {
      result.absent += 1;
      continue;
    }
    const current = deployment(value);
    // GET may omit previewIdentifier; the list-selected reference remains stable.
    if (
      current.id !== target.id ||
      current.name !== target.name ||
      current.reference !== target.reference ||
      current.deploymentType !== "preview" ||
      current.isDefault
    ) {
      throw new Error("Cleanup target changed; inspect before retrying");
    }
    await api("/deployments/" + current.name + "/delete", "POST", true);
    result.deleted += 1;
    await sleep(300);
  }
  const after = await list();
  if (targets.some((d) => after.some((a) => a.id === d.id)))
    throw new Error("Deleted previews remain in inventory");
  if (before.some((d) => d.deploymentType !== "preview" && !after.some((a) => a.id === d.id))) {
    throw new Error("A protected deployment disappeared during cleanup; inspect immediately");
  }
  return result;
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    let branch: string | undefined;
    let all = false;
    let apply = false;
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === "--branch" && args[i + 1]) branch = args[++i];
      else if (args[i] === "--all") all = true;
      else if (args[i] === "--apply") apply = true;
      else throw new Error("Usage: cleanup-convex-previews.ts (--branch NAME | --all) [--apply]");
    }
    console.log(
      JSON.stringify(
        await cleanupConvexPreviews({
          token: process.env.CONVEX_PREVIEW_DEPLOY_KEY ?? "",
          branch,
          all,
          apply,
        }),
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Preview cleanup failed");
    process.exitCode = 1;
  }
}
