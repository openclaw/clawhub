import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { json, parseJsonPayload, text } from "./httpApiV1/shared";
import { buildDeterministicPackageZip } from "./lib/skillZip";

const internalRefs = internal as unknown as {
  packages: {
    claimPackageInspectorScanBatchInternal: unknown;
    previewPackageInspectorScanBatchInternal: unknown;
    getPackageInspectorArtifactInternal: unknown;
    ingestPackageInspectorScanResultsInternal: unknown;
    sendPackageInspectorFindingsEmailInternal: unknown;
  };
};

function readBearerToken(request: Request) {
  return (
    request.headers
      .get("authorization")
      ?.match(/^Bearer\s+(.+)$/i)?.[1]
      ?.trim() ?? ""
  );
}

function requireWorkerToken(request: Request) {
  const expected = process.env.CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN?.trim() || "";
  if (!expected) return { ok: false as const, response: text("Worker unavailable", 503) };
  if (readBearerToken(request) !== expected) {
    return { ok: false as const, response: text("Unauthorized", 401) };
  }
  return { ok: true as const };
}

export function absolutePackageArtifactUrl(request: Request, releaseId: string) {
  const url = new URL("/api/v1/package-inspector/artifact", request.url);
  url.searchParams.set("releaseId", releaseId);
  return url.toString();
}

function isTruthyParam(value: string | null) {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

async function runMutationRef<T>(ctx: Pick<ActionCtx, "runMutation">, ref: unknown, args: unknown) {
  return (await ctx.runMutation(ref as never, args as never)) as T;
}

async function runQueryRef<T>(ctx: Pick<ActionCtx, "runQuery">, ref: unknown, args: unknown) {
  return (await ctx.runQuery(ref as never, args as never)) as T;
}

async function runActionRef<T>(ctx: Pick<ActionCtx, "runAction">, ref: unknown, args: unknown) {
  return (await ctx.runAction(ref as never, args as never)) as T;
}

export const packageInspectorClaimHttp = httpAction(async (ctx, request) => {
  const auth = requireWorkerToken(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const batchSize = Number(url.searchParams.get("batchSize") ?? "25");
  const cursor = url.searchParams.get("cursor");
  const dryRun = isTruthyParam(url.searchParams.get("dryRun"));
  type ClaimResult = {
    ok: true;
    leased: boolean;
    nextCursor: string | null;
    items: Array<{
      packageId: string;
      releaseId: string;
      ownerUserId?: string;
      ownerPublisherId?: string;
      packageName: string;
      version: string;
      artifactKind: string;
    }>;
  };
  const claimArgs = {
    batchSize: Number.isFinite(batchSize) ? batchSize : undefined,
    ...(dryRun ? { cursor } : {}),
  };
  const result = dryRun
    ? await runQueryRef<ClaimResult>(
        ctx,
        internalRefs.packages.previewPackageInspectorScanBatchInternal,
        claimArgs,
      )
    : await runMutationRef<ClaimResult>(
        ctx,
        internalRefs.packages.claimPackageInspectorScanBatchInternal,
        claimArgs,
      );
  return json({
    ...result,
    dryRun,
    items: result.items.map((item) => ({
      ...item,
      downloadUrl: absolutePackageArtifactUrl(request, item.releaseId),
    })),
  });
});

export const packageInspectorArtifactHttp = httpAction(async (ctx, request) => {
  const auth = requireWorkerToken(request);
  if (!auth.ok) return auth.response;
  const releaseId = new URL(request.url).searchParams.get("releaseId")?.trim();
  if (!releaseId) return text("Missing releaseId", 400);
  const artifact = await runQueryRef<{
    packageName: string;
    version: string;
    artifactKind: "legacy-zip" | "npm-pack";
    clawpackStorageId?: string;
    clawpackSha256?: string;
    npmIntegrity?: string;
    npmShasum?: string;
    npmTarballName?: string;
    files: Array<{ path: string; storageId: string }>;
  } | null>(ctx, internalRefs.packages.getPackageInspectorArtifactInternal, {
    releaseId,
  });
  if (!artifact) return text("Artifact not found", 404);

  if (artifact.artifactKind === "npm-pack") {
    if (!artifact.clawpackStorageId) return text("Artifact not found", 404);
    const blob = await ctx.storage.get(artifact.clawpackStorageId as Id<"_storage">);
    if (!blob) return text("Artifact not found", 404);
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${artifact.npmTarballName ?? `${artifact.packageName.replaceAll("/", "-")}-${artifact.version}.tgz`}"`,
      "X-ClawHub-Artifact-Type": "npm-pack-tarball",
    };
    if (artifact.clawpackSha256) {
      headers.ETag = `"sha256:${artifact.clawpackSha256}"`;
      headers["X-ClawHub-Artifact-Sha256"] = artifact.clawpackSha256;
    }
    if (artifact.npmIntegrity) headers["X-ClawHub-Npm-Integrity"] = artifact.npmIntegrity;
    if (artifact.npmShasum) headers["X-ClawHub-Npm-Shasum"] = artifact.npmShasum;
    return new Response(blob, { status: 200, headers });
  }

  const entries: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const file of artifact.files) {
    const blob = await ctx.storage.get(file.storageId as Id<"_storage">);
    if (!blob) return text(`Missing stored file: ${file.path}`, 500);
    entries.push({
      path: file.path,
      bytes: new Uint8Array(await blob.arrayBuffer()),
    });
  }
  const zip = buildDeterministicPackageZip(entries);
  return new Response(new Blob([zip], { type: "application/zip" }), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${artifact.packageName.replaceAll("/", "-")}-${artifact.version}.zip"`,
      "X-ClawHub-Artifact-Type": "legacy-plugin-zip",
    },
  });
});

export const packageInspectorResultsHttp = httpAction(async (ctx, request) => {
  const auth = requireWorkerToken(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseJsonPayload(request, {});
  if (!parsed.ok) return parsed.response;
  const payload = parsed.payload;
  const result = await runMutationRef<{
    ok: true;
    inserted: number;
    shouldEmailOwner: boolean;
  }>(ctx, internalRefs.packages.ingestPackageInspectorScanResultsInternal, {
    packageId: payload.packageId,
    releaseId: payload.releaseId,
    inspectorVersion: payload.inspectorVersion,
    targetOpenClawVersion: payload.targetOpenClawVersion,
    findings: Array.isArray(payload.findings) ? payload.findings : [],
  });
  if (result.shouldEmailOwner) {
    try {
      await runActionRef(ctx, internalRefs.packages.sendPackageInspectorFindingsEmailInternal, {
        packageId: payload.packageId,
        releaseId: payload.releaseId,
      });
    } catch (error) {
      console.error("Package Inspector findings email failed", error);
    }
  }
  return json(result);
});
