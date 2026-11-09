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
  githubToken: string;
  githubFetch?: typeof fetch;
  branch?: string;
  all?: boolean;
  apply?: boolean;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export async function cleanupConvexPreviews({
  token,
  githubToken,
  githubFetch = fetch,
  branch,
  all = false,
  apply = false,
  fetch: request = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: Options) {
  if (!token.trim().startsWith("preview:"))
    throw new Error("A Convex preview deploy key is required");
  if (!githubToken.trim()) throw new Error("A GitHub read token is required");
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
  // Raw branch names overlap Vercel/retry names. Any open branch claim wins.
  function claimedBy(identifier: string, owner: string) {
    const base = owner + "-vercel";
    return (
      identifier === owner ||
      identifier === base ||
      (identifier.startsWith(base + "-retry-") &&
        /^\d+$/.test(identifier.slice((base + "-retry-").length)))
    );
  }
  async function openBranches() {
    const branches: string[] = [];
    for (let page = 1; ; page += 1) {
      const response = await githubFetch(
        "https://api.github.com/repos/openclaw/clawhub/pulls?state=open&per_page=100&page=" + page,
        {
          headers: {
            Authorization: "Bearer " + githubToken.trim(),
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok) throw new Error("GitHub open-PR request failed (" + response.status + ")");
      const pulls: unknown = await response.json();
      if (!Array.isArray(pulls)) throw new Error("Invalid GitHub open-PR response");
      for (const pull of pulls) {
        if (pull?.state !== "open" || typeof pull?.head?.ref !== "string" || !pull.head.ref)
          throw new Error("Invalid GitHub open-PR response");
        // Fork head names also claim previews conservatively; ambiguity cannot authorize deletion.
        branches.push(pull.head.ref);
      }
      if (pulls.length < 100) return branches;
    }
  }
  function selected(d: Deployment) {
    return (
      d.deploymentType === "preview" &&
      !d.isDefault &&
      typeof d.previewIdentifier === "string" &&
      (all || claimedBy(d.previewIdentifier, branch!))
    );
  }
  function protectedBy(d: Deployment, branches: string[]) {
    return branches.some((owner) => claimedBy(d.previewIdentifier!, owner));
  }
  const before = await list();
  const candidates = before.filter(selected);
  const branches = await openBranches();
  const targets = candidates.filter((d) => !protectedBy(d, branches));
  const result = {
    selected: candidates.length,
    deleted: 0,
    absent: 0,
    preserved: candidates.length - targets.length,
    dryRun: !apply,
  };
  const deletedIds = new Set<number>();
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
    // Identity is not authority. Re-read all open PR pages after the guarded GET,
    // immediately before each destructive request; reopening revokes permission.
    if (protectedBy(target, await openBranches())) {
      result.preserved += 1;
      continue;
    }
    await api("/deployments/" + current.name + "/delete", "POST", true);
    deletedIds.add(current.id);
    result.deleted += 1;
    await sleep(300);
  }
  const after = await list();
  if (after.some((d) => deletedIds.has(d.id)))
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
          githubToken: process.env.GH_TOKEN ?? "",
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
