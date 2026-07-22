import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { buildGitHubApiHeaders } from "../lib/githubAuth";
import { computeGitHubSkillFolderContentHash } from "../lib/githubSkillSync";
import { applyRateLimit } from "../lib/httpRateLimit";
import {
  getSkillsShCatalogFixture,
  type SkillsShCatalogFixtureRow,
} from "../lib/skillsShCatalogFixtures";
import { json, requireAdminOrResponse, requireApiTokenUserOrResponse, text } from "./shared";

const internalRefs = internal as unknown as {
  skillsShCatalog: {
    admitRealScansInternal: unknown;
    assertFreshGitHubOwnerAssignmentsInternal: unknown;
    getRunReconciliationInternal: unknown;
    getStagingLiveControlInternal: unknown;
    processFixtureBatchInternal: unknown;
    processStagingLiveBatchInternal: unknown;
    resolveKnownGitHubOwnersInternal: unknown;
    rollbackFixtureRunInternal: unknown;
    startFixtureRunInternal: unknown;
    startStagingLiveRunInternal: unknown;
  };
};
const MAX_GITHUB_OWNER_RESOLUTIONS = 500;
const GITHUB_OWNER_RESOLUTION_CONCURRENCY = 8;
const CONTROLLED_CANARY_FIXTURE_ID = "patrick-html-canary-v1";
const MAX_CONTROLLED_CANARY_FILES = 100;

async function runMutationRef<T>(
  ctx: ActionCtx,
  ref: unknown,
  args: Record<string, unknown>,
): Promise<T> {
  return (await ctx.runMutation(ref as never, args as never)) as T;
}

async function runActionRef<T>(ctx: ActionCtx, ref: unknown, args: Record<string, unknown>) {
  return (await ctx.runAction(ref as never, args as never)) as T;
}

async function runQueryRef<T>(
  ctx: ActionCtx,
  ref: unknown,
  args: Record<string, unknown>,
): Promise<T> {
  return (await ctx.runQuery(ref as never, args as never)) as T;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requireString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required`);
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} is required`);
  return value;
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function normalizeGitHubOwners(ownersValue: unknown) {
  if (!Array.isArray(ownersValue)) throw new Error("owners is required");
  const owners = Array.from(
    new Set(
      ownersValue.map((owner) => {
        if (typeof owner !== "string" || !owner.trim()) {
          throw new Error("owner must be a non-empty string");
        }
        return owner.trim().toLowerCase();
      }),
    ),
  ).sort();
  if (owners.length < 1 || owners.length > MAX_GITHUB_OWNER_RESOLUTIONS) {
    throw new Error(`owners must contain between 1 and ${MAX_GITHUB_OWNER_RESOLUTIONS} entries`);
  }
  return owners;
}

async function fetchAuthenticatedGitHubOwners(owners: string[]) {
  if (owners.length === 0) return [];
  const headers = await buildGitHubApiHeaders({
    userAgent: "clawhub/skills-sh-catalog-test",
    allowAnonymous: false,
    useGitHubApp: false,
  });
  const resolved: Array<{ owner: string; id: number; login: string }> = [];
  for (let offset = 0; offset < owners.length; offset += GITHUB_OWNER_RESOLUTION_CONCURRENCY) {
    const batch = owners.slice(offset, offset + GITHUB_OWNER_RESOLUTION_CONCURRENCY);
    resolved.push(
      ...(await Promise.all(
        batch.map(async (owner) => {
          const response = await fetch(
            `https://api.github.com/users/${encodeURIComponent(owner)}`,
            {
              headers,
            },
          );
          if (!response.ok) {
            throw new Error(
              `Authenticated GitHub owner lookup failed with HTTP ${response.status}: ${owner}`,
            );
          }
          const payload = (await response.json()) as { id?: unknown; login?: unknown };
          const id = typeof payload.id === "number" ? payload.id : Number.NaN;
          const login = typeof payload.login === "string" ? payload.login.trim().toLowerCase() : "";
          if (!Number.isSafeInteger(id) || id <= 0 || login !== owner) {
            throw new Error(
              `Authenticated GitHub owner lookup returned invalid identity: ${owner}`,
            );
          }
          return { owner, id, login };
        }),
      )),
    );
  }
  return resolved;
}

async function fetchGitHubJson(
  url: string,
  headers: Record<string, string>,
  label: string,
  fetchImpl: typeof fetch,
) {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

function decodeGitHubBlob(payload: Record<string, unknown>, path: string) {
  if (payload.encoding !== "base64" || typeof payload.content !== "string") {
    throw new Error(`Controlled canary returned invalid GitHub blob content: ${path}`);
  }
  return decodeBase64(payload.content.replace(/\s+/g, ""));
}

export async function verifyControlledCanaryGitHubSource(options: {
  expected?: SkillsShCatalogFixtureRow;
  fetchImpl?: typeof fetch;
  checkedAt?: string;
}) {
  const expected =
    options.expected ??
    getSkillsShCatalogFixture(CONTROLLED_CANARY_FIXTURE_ID).findByExternalId(
      "patrick-erichsen/skills/html",
    );
  if (!expected || !expected.githubPath || !expected.githubCommit || !expected.githubContentHash) {
    throw new Error("Controlled canary fixture lacks immutable GitHub provenance");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = await buildGitHubApiHeaders({
    userAgent: "clawhub/skills-sh-catalog-canary",
    allowAnonymous: false,
    useGitHubApp: false,
  });
  const repository = await fetchGitHubJson(
    `https://api.github.com/repos/${encodeURIComponent(expected.owner)}/${encodeURIComponent(expected.repo)}`,
    headers,
    "Controlled canary GitHub repository lookup",
    fetchImpl,
  );
  const repositoryOwner = asRecord(repository.owner);
  if (
    repository.private !== false ||
    requireString(repository, "full_name").toLowerCase() !==
      `${expected.owner}/${expected.repo}`.toLowerCase() ||
    requireNumber(repositoryOwner ?? {}, "id") !== expected.githubOwnerId ||
    requireString(repositoryOwner ?? {}, "login").toLowerCase() !== expected.owner.toLowerCase()
  ) {
    throw new Error("Controlled canary GitHub repository identity mismatch");
  }
  const commit = await fetchGitHubJson(
    `https://api.github.com/repos/${encodeURIComponent(expected.owner)}/${encodeURIComponent(expected.repo)}/git/commits/${encodeURIComponent(expected.githubCommit)}`,
    headers,
    "Controlled canary GitHub commit lookup",
    fetchImpl,
  );
  const commitSha = requireString(commit, "sha").toLowerCase();
  const commitTree = asRecord(commit.tree);
  const treeSha = requireString(commitTree ?? {}, "sha");
  if (commitSha !== expected.githubCommit.toLowerCase()) {
    throw new Error("Controlled canary GitHub commit mismatch");
  }
  const tree = await fetchGitHubJson(
    `https://api.github.com/repos/${encodeURIComponent(expected.owner)}/${encodeURIComponent(expected.repo)}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
    headers,
    "Controlled canary GitHub tree lookup",
    fetchImpl,
  );
  if (tree.truncated !== false || !Array.isArray(tree.tree)) {
    throw new Error("Controlled canary GitHub tree is incomplete");
  }
  const prefix = `${expected.githubPath.replace(/\/+$/g, "")}/`;
  const blobs = tree.tree
    .map(asRecord)
    .filter(
      (entry): entry is Record<string, unknown> =>
        entry !== null &&
        entry.type === "blob" &&
        typeof entry.path === "string" &&
        entry.path.startsWith(prefix),
    )
    .sort((left, right) => String(left.path).localeCompare(String(right.path)));
  if (blobs.length < 1 || blobs.length > MAX_CONTROLLED_CANARY_FILES) {
    throw new Error("Controlled canary GitHub folder has an invalid file count");
  }
  const entries: Record<string, Uint8Array> = {};
  for (const blob of blobs) {
    const path = requireString(blob, "path");
    const blobSha = requireString(blob, "sha");
    const payload = await fetchGitHubJson(
      `https://api.github.com/repos/${encodeURIComponent(expected.owner)}/${encodeURIComponent(expected.repo)}/git/blobs/${encodeURIComponent(blobSha)}`,
      headers,
      `Controlled canary GitHub blob lookup: ${path}`,
      fetchImpl,
    );
    entries[path] = decodeGitHubBlob(payload, path);
  }
  const contentHash = await computeGitHubSkillFolderContentHash(entries, expected.githubPath);
  if (contentHash !== expected.githubContentHash.toLowerCase()) {
    throw new Error("Controlled canary GitHub content hash mismatch");
  }
  const checkedAt = options.checkedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(checkedAt))) {
    throw new Error("Controlled canary GitHub checked time is invalid");
  }
  return {
    authentication: "clawhub-github-authenticated" as const,
    fixtureId: CONTROLLED_CANARY_FIXTURE_ID,
    externalId: expected.externalId,
    githubOwnerId: expected.githubOwnerId,
    githubRepo: `${expected.owner}/${expected.repo}`,
    githubPath: expected.githubPath,
    githubCommit: commitSha,
    githubContentHash: contentHash,
    githubCheckedAt: checkedAt,
    githubFetches: 3 + blobs.length,
  };
}

async function resolveAuthenticatedGitHubOwners(ctx: ActionCtx, ownersValue: unknown) {
  const owners = normalizeGitHubOwners(ownersValue);
  const known = await runQueryRef<{
    provenance: "stored-authenticated-staging-live";
    owners: Array<{ owner: string; id: number; login: string }>;
    missingOwners: string[];
  }>(ctx, internalRefs.skillsShCatalog.resolveKnownGitHubOwnersInternal, { owners });
  const fetched = await fetchAuthenticatedGitHubOwners(known.missingOwners);
  if (fetched.length > 0) {
    await runQueryRef(ctx, internalRefs.skillsShCatalog.assertFreshGitHubOwnerAssignmentsInternal, {
      owners: fetched.map(({ owner, id }) => ({ owner, id })),
    });
  }
  const resolved = [...known.owners, ...fetched].sort((left, right) =>
    left.owner.localeCompare(right.owner),
  );
  if (resolved.length !== owners.length) {
    throw new Error("GitHub owner resolution did not return complete coverage");
  }
  return {
    authentication: "clawhub-github-authenticated" as const,
    provenance:
      known.owners.length === 0
        ? ("live-github" as const)
        : fetched.length === 0
          ? ("stored-authenticated-staging-live" as const)
          : ("stored-authenticated-staging-live+live-github" as const),
    fetches: fetched.length,
    reused: known.owners.length,
    owners: resolved,
  };
}

async function storeArtifactFiles(
  ctx: ActionCtx,
  artifactsValue: unknown,
): Promise<{
  artifacts: Array<{
    externalId: string;
    artifactContentHash: string;
    files: Array<{
      path: string;
      size: number;
      storageId: Id<"_storage">;
      sha256: string;
      contentType?: string;
    }>;
  }>;
  storageIds: Id<"_storage">[];
}> {
  if (!Array.isArray(artifactsValue) || artifactsValue.length < 1 || artifactsValue.length > 10) {
    throw new Error("artifacts must contain between 1 and 10 entries");
  }
  const storageIds: Id<"_storage">[] = [];
  const artifacts = [];
  const externalIds = new Set<string>();
  try {
    for (const artifactValue of artifactsValue) {
      const artifact = asRecord(artifactValue);
      if (!artifact) throw new Error("artifact must be an object");
      const externalId = requireString(artifact, "externalId").trim().toLowerCase();
      if (externalIds.has(externalId)) throw new Error(`duplicate artifact: ${externalId}`);
      externalIds.add(externalId);
      const filesValue = artifact.files;
      if (!Array.isArray(filesValue) || filesValue.length < 1 || filesValue.length > 100) {
        throw new Error("artifact files must contain between 1 and 100 entries");
      }
      const files = [];
      const filePaths = new Set<string>();
      for (const fileValue of filesValue) {
        const file = asRecord(fileValue);
        if (!file) throw new Error("artifact file must be an object");
        const path = requireString(file, "path");
        if (filePaths.has(path)) throw new Error(`duplicate artifact file path: ${path}`);
        filePaths.add(path);
        const contentBase64 = requireString(file, "contentBase64");
        const bytes = decodeBase64(contentBase64);
        const declaredSha256 = requireString(file, "sha256").toLowerCase();
        if ((await sha256Hex(bytes)) !== declaredSha256) {
          throw new Error(`artifact file hash mismatch: ${path}`);
        }
        const contentType =
          typeof file.contentType === "string" && file.contentType.trim()
            ? file.contentType.trim()
            : undefined;
        const storageId = await ctx.storage.store(
          new Blob([bytes], { type: contentType ?? "application/octet-stream" }),
        );
        storageIds.push(storageId);
        files.push({
          path,
          size: bytes.byteLength,
          storageId,
          sha256: declaredSha256,
          ...(contentType ? { contentType } : {}),
        });
      }
      files.sort((left, right) => left.path.localeCompare(right.path));
      const artifactContentHash = requireString(artifact, "artifactContentHash").toLowerCase();
      const manifest = files.map((file) => `${file.path}\0${file.sha256}\n`).join("");
      const computedArtifactHash = await sha256Hex(new TextEncoder().encode(manifest));
      if (computedArtifactHash !== artifactContentHash) {
        throw new Error(`artifact manifest hash mismatch: ${externalId}`);
      }
      artifacts.push({
        externalId,
        artifactContentHash,
        files,
      });
    }
  } catch (error) {
    await Promise.allSettled(
      storageIds.map(async (storageId) => await ctx.storage.delete(storageId)),
    );
    throw error;
  }
  return { artifacts, storageIds };
}

export async function skillsShCatalogTestV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, request.method === "GET" ? "read" : "write");
  if (!rate.ok) return rate.response;
  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;
  const admin = requireAdminOrResponse(auth.user, rate.headers);
  if (!admin.ok) return admin.response;

  try {
    const staging = await runQueryRef<{
      environment: "test";
      deploymentName: string | null;
      buildSha: string | null;
      control: Record<string, unknown>;
    }>(ctx, internalRefs.skillsShCatalog.getStagingLiveControlInternal, {});
    if (request.method === "GET") return json(staging, 200, rate.headers);
    if (request.method !== "POST") return text("Not found", 404, rate.headers);

    const body = asRecord(await request.json());
    if (!body) return text("Invalid JSON", 400, rate.headers);
    const operation = requireString(body, "operation");
    if (operation === "verify-canary") {
      return json(await verifyControlledCanaryGitHubSource({}), 200, rate.headers);
    }
    if (operation === "start-canary") {
      const verification = await verifyControlledCanaryGitHubSource({});
      const sourceVerification = {
        githubOwnerId: verification.githubOwnerId,
        githubCommit: verification.githubCommit,
        githubContentHash: verification.githubContentHash,
        githubCheckedAt: verification.githubCheckedAt,
        githubFetches: verification.githubFetches,
      };
      const result = await runMutationRef<{ runId: string }>(
        ctx,
        internalRefs.skillsShCatalog.startFixtureRunInternal,
        {
          fixtureId: CONTROLLED_CANARY_FIXTURE_ID,
          actor: auth.user.handle,
          reason: requireString(body, "reason"),
          sourceVerification,
        },
      );
      return json({ ...result, sourceVerification: verification }, 200, rate.headers);
    }
    if (operation === "process-fixture") {
      return json(
        await runMutationRef(ctx, internalRefs.skillsShCatalog.processFixtureBatchInternal, {
          runId: requireString(body, "runId"),
        }),
        200,
        rate.headers,
      );
    }
    if (operation === "reconcile") {
      return json(
        await runQueryRef(ctx, internalRefs.skillsShCatalog.getRunReconciliationInternal, {
          runId: requireString(body, "runId"),
        }),
        200,
        rate.headers,
      );
    }
    if (operation === "rollback-canary") {
      return json(
        await runMutationRef(ctx, internalRefs.skillsShCatalog.rollbackFixtureRunInternal, {
          runId: requireString(body, "runId"),
          actor: auth.user.handle,
          reason: requireString(body, "reason"),
          confirm: requireString(body, "confirm"),
        }),
        200,
        rate.headers,
      );
    }
    if (operation === "resolve-owners") {
      return json(await resolveAuthenticatedGitHubOwners(ctx, body.owners), 200, rate.headers);
    }
    if (operation === "start") {
      const result = await runMutationRef(
        ctx,
        internalRefs.skillsShCatalog.startStagingLiveRunInternal,
        {
          actor: auth.user.handle,
          reason: requireString(body, "reason"),
          snapshotId: requireString(body, "snapshotId"),
          sourceCapturedAt: requireString(body, "sourceCapturedAt"),
          snapshotCaptureFetches: requireNumber(body, "snapshotCaptureFetches"),
          fixtureLength: requireNumber(body, "fixtureLength"),
        },
      );
      return json(result, 200, rate.headers);
    }
    if (operation === "batch") {
      if (!Array.isArray(body.rows)) throw new Error("rows is required");
      const result = await runMutationRef(
        ctx,
        internalRefs.skillsShCatalog.processStagingLiveBatchInternal,
        {
          runId: requireString(body, "runId"),
          cursor: requireNumber(body, "cursor"),
          rows: body.rows,
        },
      );
      return json(result, 200, rate.headers);
    }
    if (operation === "admit") {
      if (!Array.isArray(body.externalIds)) throw new Error("externalIds is required");
      const stored = await storeArtifactFiles(ctx, body.artifacts);
      let result: {
        admittedExternalIds: string[];
        [key: string]: unknown;
      };
      try {
        result = await runActionRef(ctx, internalRefs.skillsShCatalog.admitRealScansInternal, {
          runId: requireString(body, "runId"),
          externalIds: body.externalIds,
          actorUserId: auth.userId,
          artifacts: stored.artifacts,
        });
      } catch (error) {
        await Promise.allSettled(
          stored.storageIds.map(async (storageId) => await ctx.storage.delete(storageId)),
        );
        throw error;
      }
      const admittedExternalIds = new Set(result.admittedExternalIds);
      const unlinkedStorageIds = stored.artifacts
        .filter((artifact) => !admittedExternalIds.has(artifact.externalId))
        .flatMap((artifact) => artifact.files.map((file) => file.storageId));
      await Promise.allSettled(
        unlinkedStorageIds.map(async (storageId) => await ctx.storage.delete(storageId)),
      );
      return json(result, 200, rate.headers);
    }
    return text("Unknown operation", 400, rate.headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "skills.sh Test operation failed";
    const unavailable =
      message.includes("permanent Test") || message.includes("available only in permanent Test");
    return text(unavailable ? "Not found" : message, unavailable ? 404 : 400, rate.headers);
  }
}
