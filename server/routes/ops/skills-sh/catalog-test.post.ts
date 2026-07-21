import { getVercelOidcToken } from "@vercel/oidc";
import { defineEventHandler, getHeader, readBody } from "h3";
import {
  captureSkillsShCatalogTestSnapshot,
  getSkillsShCatalogTestSourcePolicy,
  type SkillsShCatalogGitHubOwnerProof,
} from "../../../skillsShCatalogSource";

const TEST_CONVEX_SITE_URL = "https://academic-chihuahua-392.convex.site";
const OPERATOR_PATH = "/api/v1/operator/skills-sh/catalog-test";
const MAX_BATCH_SIZE = 50;

type CatalogTestRequest = {
  allowlist?: string[];
  reason?: string;
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function callConvexOperator(
  authorization: string,
  init: { method: "GET" } | { method: "POST"; body: Record<string, unknown> },
) {
  const response = await fetch(`${TEST_CONVEX_SITE_URL}${OPERATOR_PATH}`, {
    method: init.method,
    headers: {
      Accept: "application/json",
      Authorization: authorization,
      ...(init.method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.method === "POST" ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Convex Test operator returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

async function executeSnapshotRun(
  authorization: string,
  snapshot: {
    snapshotId: string;
    capturedAt: string;
    rows: Array<Record<string, unknown>>;
    metrics: { skillsShFetches: number };
  },
  reason: string,
  batchSize: number,
) {
  const start = await callConvexOperator(authorization, {
    method: "POST",
    body: {
      operation: "start",
      reason,
      snapshotId: snapshot.snapshotId,
      sourceCapturedAt: snapshot.capturedAt,
      snapshotCaptureFetches: snapshot.metrics.skillsShFetches,
      fixtureLength: snapshot.rows.length,
    },
  });
  const runId = start.runId;
  if (typeof runId !== "string") throw new Error("Convex Test operator did not return a run id");

  let run: Record<string, unknown> | null = null;
  for (let cursor = 0; cursor < snapshot.rows.length; cursor += batchSize) {
    run = await callConvexOperator(authorization, {
      method: "POST",
      body: {
        operation: "batch",
        runId,
        cursor,
        rows: snapshot.rows.slice(cursor, cursor + batchSize),
      },
    });
  }
  return { runId, run };
}

function batchSizeFromControl(control: Record<string, unknown>) {
  const maxEntriesPerBatch = control.maxEntriesPerBatch;
  const maxWritesPerBatch = control.maxWritesPerBatch;
  if (
    typeof maxEntriesPerBatch !== "number" ||
    !Number.isInteger(maxEntriesPerBatch) ||
    maxEntriesPerBatch < 1 ||
    typeof maxWritesPerBatch !== "number" ||
    !Number.isInteger(maxWritesPerBatch) ||
    maxWritesPerBatch < 2
  ) {
    throw new Error("Convex Test controls do not provide usable batch budgets");
  }
  return Math.min(MAX_BATCH_SIZE, maxEntriesPerBatch, Math.floor(maxWritesPerBatch / 2));
}

export default defineEventHandler(async (event) => {
  const policy = getSkillsShCatalogTestSourcePolicy(process.env);
  if (!policy.allowed) return jsonResponse({ error: "not_found" }, 404);
  const authorization = getHeader(event, "authorization")?.trim() ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return jsonResponse({ error: "operator_authorization_required" }, 401);
  }
  const body = ((await readBody<CatalogTestRequest>(event)) ?? {}) as CatalogTestRequest;
  const allowlist = Array.from(
    new Set((body.allowlist ?? []).map((externalId) => externalId.trim().toLowerCase())),
  ).filter(Boolean);
  if (allowlist.length > policy.maxRealScanAdmissions) {
    return jsonResponse({ error: "allowlist_exceeds_test_ceiling" }, 400);
  }
  const memoryStart = process.memoryUsage();
  const startedAt = Date.now();
  try {
    const staging = await callConvexOperator(authorization, { method: "GET" });
    const control = staging.control;
    if (!control || typeof control !== "object") {
      throw new Error("Convex Test operator did not return catalog controls");
    }
    const batchSize = batchSizeFromControl(control as Record<string, unknown>);
    const snapshot = await captureSkillsShCatalogTestSnapshot({
      env: process.env,
      async getOidcToken() {
        return await getVercelOidcToken();
      },
      readConvexControl: async () =>
        control as {
          mode: "off" | "fixture" | "staging-live";
          discoveryEnabled: boolean;
          writesEnabled: boolean;
          scanPlanningEnabled: boolean;
          maxEntriesPerRun: number;
          publicVisibilityEnabled: boolean;
        },
      admitExternalIds: allowlist,
      resolveGitHubOwners: async (owners) =>
        (await callConvexOperator(authorization, {
          method: "POST",
          body: {
            operation: "resolve-owners",
            owners,
          },
        })) as SkillsShCatalogGitHubOwnerProof,
    });
    const reason = body.reason?.trim() || "bounded permanent Test skills.sh proof";
    const firstRun = await executeSnapshotRun(authorization, snapshot, reason, batchSize);
    const identicalRerun = await executeSnapshotRun(
      authorization,
      snapshot,
      `${reason} identical rerun`,
      batchSize,
    );
    const admission =
      allowlist.length > 0
        ? await callConvexOperator(authorization, {
            method: "POST",
            body: {
              operation: "admit",
              runId: firstRun.runId,
              externalIds: allowlist,
              artifacts: snapshot.artifacts,
            },
          })
        : { requested: 0, admitted: 0, skipped: 0 };
    const memoryEnd = process.memoryUsage();
    return jsonResponse({
      ok: true,
      source: {
        project: "openclaw-foundation/clawhub",
        vercelSourceSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        vercelTargetEnvironment: process.env.VERCEL_TARGET_ENV ?? null,
        verifiedIdentity: snapshot.verifiedIdentity,
        snapshotId: snapshot.snapshotId,
        capturedAt: snapshot.capturedAt,
        selection: snapshot.selection,
        fetches: snapshot.metrics,
      },
      convex: {
        deploymentName: staging.deploymentName,
        buildSha: staging.buildSha,
        firstRun,
        identicalRerun,
        admission,
      },
      runtime: {
        elapsedMs: Date.now() - startedAt,
        rssStartBytes: memoryStart.rss,
        rssEndBytes: memoryEnd.rss,
        heapUsedStartBytes: memoryStart.heapUsed,
        heapUsedEndBytes: memoryEnd.heapUsed,
      },
      controls: {
        publicVisibilityEnabled: false,
        schedulesEnabled: false,
        maxRealScanAdmissions: policy.maxRealScanAdmissions,
        batchSize,
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        error: "skills_sh_catalog_test_failed",
        message: error instanceof Error ? error.message : "Unknown Test gate failure",
      },
      502,
    );
  }
});
