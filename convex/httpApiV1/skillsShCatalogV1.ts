import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { buildGitHubApiHeaders } from "../lib/githubAuth";
import { applyRateLimit } from "../lib/httpRateLimit";
import { json, requireAdminOrResponse, requireApiTokenUserOrResponse, text } from "./shared";

const internalRefs = internal as unknown as {
  skillsShCatalog: {
    admitRealScansInternal: unknown;
    getStagingLiveControlInternal: unknown;
    processStagingLiveBatchInternal: unknown;
    startStagingLiveRunInternal: unknown;
  };
};
const MAX_GITHUB_OWNER_RESOLUTIONS = 500;
const GITHUB_OWNER_RESOLUTION_CONCURRENCY = 8;

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

async function resolveAuthenticatedGitHubOwners(ownersValue: unknown) {
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
  return {
    authentication: "clawhub-github-authenticated" as const,
    fetches: resolved.length,
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
    if (operation === "resolve-owners") {
      return json(await resolveAuthenticatedGitHubOwners(body.owners), 200, rate.headers);
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
