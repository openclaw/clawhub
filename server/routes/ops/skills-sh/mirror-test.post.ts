import { getVercelOidcToken } from "@vercel/oidc";
import { defineEventHandler, getHeader, readBody } from "h3";
import {
  buildSkillsShMirrorProofSnapshotId,
  fetchSkillsShMirrorBatch,
  fetchSkillsShMirrorControlledBatch,
  getSkillsShCatalogTestSourcePolicy,
  measureSkillsShMirrorProofSource,
  parseSkillsShMirrorProofSnapshotId,
  skillsShSourceRetryAfterSeconds,
} from "../../../skillsShCatalogSource";
import {
  buildSkillsShMirrorReplayRows,
  enrichSkillsShMirrorClassifications,
  type SkillsShMirrorClassificationState,
} from "../../../skillsShMirrorClassification";

const TEST_CONVEX_SITE_URL = "https://academic-chihuahua-392.convex.site";
const OPERATOR_PATH = "/api/v1/operator/skills-sh/catalog-test";
const SOURCE_PAGE_SIZE = 500;
const MIRROR_BATCH_SIZE = 50;
const MAX_TEST_SOURCE_ROWS = 50_000;
const MAX_DETAIL_BYTES = 64 * 1024;
const MAX_DETAIL_PAGE_ROWS = 50;
const BATCH_LEASE_HEARTBEAT_INTERVAL_MS = 60_000;

type MirrorRequest = {
  operation?:
    | "configure"
    | "start"
    | "start-replay"
    | "run"
    | "step"
    | "step-replay"
    | "pause"
    | "resume"
    | "discard"
    | "reconcile"
    | "conflicts"
    | "status"
    | "isolation"
    | "read"
    | "source-summary"
    | "page"
    | "detail-page"
    | "facet-page";
  enabled?: boolean;
  externalId?: string;
  externalIds?: string[];
  cursor?: string | null;
  capturedRunId?: string;
  hasMore?: boolean;
  limit?: number;
  offset?: number;
  page?: number;
  pageLength?: number;
  reason?: string;
  runId?: string;
  snapshotHash?: string;
  sourceMeasuredAt?: string;
  sourcePageSize?: number;
  sourceTotal?: number;
};

function jsonResponse(payload: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function requireString(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function requireInteger(value: number | undefined, name: string, min: number, max: number) {
  if (!Number.isInteger(value) || value === undefined || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function assertNoActiveMirrorRun(status: Record<string, unknown>) {
  if (!Array.isArray(status.runs)) {
    throw new Error("skills.sh mirror status response lacks runs");
  }
  const activeRun = status.runs.find((value) => {
    if (value === null || typeof value !== "object") return false;
    const runStatus = (value as Record<string, unknown>).status;
    return runStatus === "running" || runStatus === "paused" || runStatus === "reconciling";
  });
  if (activeRun === undefined) return;
  const runId =
    activeRun !== null &&
    typeof activeRun === "object" &&
    typeof (activeRun as Record<string, unknown>).runId === "string"
      ? `: ${(activeRun as Record<string, unknown>).runId}`
      : "";
  throw new Error(`skills.sh mirror already has an active run${runId}`);
}

async function callConvexOperator(authorization: string, body: Record<string, unknown>) {
  const response = await fetch(`${TEST_CONVEX_SITE_URL}${OPERATOR_PATH}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Convex Test mirror operator returned HTTP ${response.status}: ${text}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function createBatchLeaseHeartbeat(args: {
  authorization: string;
  runId: string;
  page: number;
  offset: number;
  leaseToken: string;
}) {
  let nextHeartbeatAt = Date.now() + BATCH_LEASE_HEARTBEAT_INTERVAL_MS;
  let pending: Promise<void> | null = null;
  return async () => {
    if (Date.now() < nextHeartbeatAt) return;
    if (pending) return await pending;
    pending = callConvexOperator(args.authorization, {
      operation: "mirror-batch-claim",
      runId: args.runId,
      page: args.page,
      offset: args.offset,
      leaseToken: args.leaseToken,
    })
      .then(() => undefined)
      .finally(() => {
        nextHeartbeatAt = Date.now() + BATCH_LEASE_HEARTBEAT_INTERVAL_MS;
        pending = null;
      });
    await pending;
  };
}

export default defineEventHandler(async (event) => {
  const policy = getSkillsShCatalogTestSourcePolicy(process.env);
  if (!policy.allowed) return jsonResponse({ error: "not_found" }, 404);
  const authorization = getHeader(event, "authorization")?.trim() ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const body = (await readBody(event)) as MirrorRequest;
    const operation = body.operation;
    if (operation === "status") {
      return jsonResponse(await callConvexOperator(authorization, { operation: "mirror-status" }));
    }
    if (operation === "run") {
      return jsonResponse(
        await callConvexOperator(authorization, {
          operation: "mirror-run",
          runId: requireString(body.runId, "runId"),
        }),
      );
    }
    if (operation === "isolation") {
      return jsonResponse(
        await callConvexOperator(authorization, { operation: "mirror-isolation" }),
      );
    }
    if (operation === "read") {
      return jsonResponse(
        await callConvexOperator(authorization, {
          operation: "mirror-read",
          externalId: requireString(body.externalId, "externalId"),
        }),
      );
    }
    if (operation === "source-summary") {
      return jsonResponse(
        await callConvexOperator(authorization, {
          operation: "mirror-source-summary",
          snapshotHash: requireString(body.snapshotHash, "snapshotHash"),
        }),
      );
    }
    if (operation === "conflicts") {
      return jsonResponse(
        await callConvexOperator(authorization, {
          operation: "mirror-conflicts",
          runId: requireString(body.runId, "runId"),
          limit: requireInteger(body.limit, "limit", 1, 50),
        }),
      );
    }
    if (operation === "page") {
      return jsonResponse(
        await callConvexOperator(authorization, {
          operation: "mirror-page",
          cursor: body.cursor ?? null,
          limit: requireInteger(body.limit, "limit", 1, 500),
        }),
      );
    }
    if (operation === "detail-page") {
      return jsonResponse(
        await callConvexOperator(authorization, {
          operation: "mirror-detail-page",
          cursor: body.cursor ?? null,
          limit: requireInteger(body.limit, "limit", 1, MAX_DETAIL_PAGE_ROWS),
        }),
      );
    }
    if (operation === "facet-page") {
      return jsonResponse(
        await callConvexOperator(authorization, {
          operation: "mirror-facet-page",
          cursor: body.cursor ?? null,
          limit: requireInteger(body.limit, "limit", 1, 500),
        }),
      );
    }
    if (operation === "configure") {
      return jsonResponse(
        await callConvexOperator(authorization, {
          operation: "mirror-configure",
          enabled: body.enabled === true,
          reason: requireString(body.reason, "reason"),
          confirm: "enable-skills-sh-mirror-test",
          maxRowsPerRun: MAX_TEST_SOURCE_ROWS,
          maxRowsPerBatch: MIRROR_BATCH_SIZE,
          maxDetailBytes: MAX_DETAIL_BYTES,
        }),
      );
    }
    if (operation === "start") {
      assertNoActiveMirrorRun(
        await callConvexOperator(authorization, { operation: "mirror-status" }),
      );
      const oidcToken = await getVercelOidcToken();
      const sourceMeasuredAt = new Date().toISOString();
      const source = await measureSkillsShMirrorProofSource({ oidcToken });
      if (source.catalogTotal < 1 || source.catalogTotal > MAX_TEST_SOURCE_ROWS) {
        throw new Error(
          `skills.sh source total ${source.catalogTotal} exceeds the Test mirror capacity`,
        );
      }
      const sourceTotal = source.catalogTotal + source.controlledSupplementExternalIds.length;
      if (sourceTotal > MAX_TEST_SOURCE_ROWS) {
        throw new Error(`skills.sh proof source total ${sourceTotal} exceeds the Test capacity`);
      }
      const snapshotId = buildSkillsShMirrorProofSnapshotId(source);
      const snapshot = parseSkillsShMirrorProofSnapshotId(snapshotId);
      const sourceSnapshotHash = requireString(snapshot.sourceSnapshotHash, "sourceSnapshotHash");
      let sourceCaptureWrites = 0;
      for (const page of source.sourcePages) {
        const stored = await callConvexOperator(authorization, {
          operation: "mirror-source-page-store",
          snapshotHash: sourceSnapshotHash,
          ...page,
        });
        if (stored.stored === true) sourceCaptureWrites += 1;
      }
      const sourceCapture = await callConvexOperator(authorization, {
        operation: "mirror-source-summary",
        snapshotHash: sourceSnapshotHash,
      });
      const result = await callConvexOperator(authorization, {
        operation: "mirror-start",
        reason: requireString(body.reason, "reason"),
        snapshotId,
        sourceSnapshotHash,
        sourceCaptureWrites,
        sourceTotal,
        sourcePageSize: SOURCE_PAGE_SIZE,
        sourceMeasuredAt,
      });
      return jsonResponse({
        ...result,
        sourceTotal,
        sourceCatalogTotal: source.catalogTotal,
        controlledOverlayTotal: source.controlledOverlayExternalIds.length,
        controlledSupplementTotal: source.controlledSupplementExternalIds.length,
        sourceMeasurementRequests: source.sourceRequests,
        sourceCapture: {
          ...sourceCapture,
          requestDbWrites: sourceCaptureWrites,
        },
        sourceMeasuredAt,
        sourcePageSize: SOURCE_PAGE_SIZE,
      });
    }
    if (operation === "start-replay") {
      const sourceMeasuredAt = requireString(body.sourceMeasuredAt, "sourceMeasuredAt");
      if (Number.isNaN(Date.parse(sourceMeasuredAt))) {
        throw new Error("sourceMeasuredAt must be an ISO timestamp");
      }
      const sourceTotal = requireInteger(body.sourceTotal, "sourceTotal", 1, MAX_TEST_SOURCE_ROWS);
      const sourcePageSize = requireInteger(
        body.sourcePageSize,
        "sourcePageSize",
        1,
        SOURCE_PAGE_SIZE,
      );
      const result = await callConvexOperator(authorization, {
        operation: "mirror-start",
        reason: requireString(body.reason, "reason"),
        snapshotId: `skills-sh-captured:${requireString(body.capturedRunId, "capturedRunId")}`,
        sourceTotal,
        sourcePageSize,
        sourceMeasuredAt,
      });
      return jsonResponse({
        ...result,
        sourceTotal,
        sourceMeasuredAt,
        sourcePageSize,
        captured: true,
      });
    }
    if (operation === "step") {
      const runId = requireString(body.runId, "runId");
      const page = requireInteger(body.page, "page", 0, 100_000);
      const offset = requireInteger(body.offset, "offset", 0, SOURCE_PAGE_SIZE - 1);
      const leaseToken = crypto.randomUUID();
      const lease = await callConvexOperator(authorization, {
        operation: "mirror-batch-claim",
        runId,
        page,
        offset,
        leaseToken,
      });
      try {
        const sourceTotal = requireInteger(
          typeof lease.sourceTotal === "number" ? lease.sourceTotal : undefined,
          "lease.sourceTotal",
          1,
          MAX_TEST_SOURCE_ROWS,
        );
        const snapshot = parseSkillsShMirrorProofSnapshotId(
          requireString(
            typeof lease.snapshotId === "string" ? lease.snapshotId : undefined,
            "lease.snapshotId",
          ),
        );
        if (
          sourceTotal !==
          snapshot.catalogTotal + snapshot.controlledSupplementExternalIds.length
        ) {
          throw new Error("skills.sh mirror run proof source metadata is inconsistent");
        }
        const controlledPage = Math.ceil(snapshot.catalogTotal / SOURCE_PAGE_SIZE);
        const beforeRequest = createBatchLeaseHeartbeat({
          authorization,
          runId,
          page,
          offset,
          leaseToken,
        });
        const batch =
          page === controlledPage && snapshot.controlledSupplementExternalIds.length > 0
            ? await fetchSkillsShMirrorControlledBatch(
                {
                  page,
                  offset,
                  limit: MIRROR_BATCH_SIZE,
                  maxDetailBytes: MAX_DETAIL_BYTES,
                  sourceTotal,
                  externalIds: snapshot.controlledSupplementExternalIds,
                },
                { beforeRequest },
              )
            : page < controlledPage
              ? await (async () => {
                  const capturedPage =
                    lease.sourcePage &&
                    typeof lease.sourcePage === "object" &&
                    !Array.isArray(lease.sourcePage)
                      ? (lease.sourcePage as Record<string, unknown>)
                      : null;
                  const expectedPage = snapshot.evidence?.pagination.requestedPages.find(
                    (entry) => entry.page === page,
                  );
                  if (
                    !capturedPage ||
                    !expectedPage ||
                    capturedPage.page !== page ||
                    capturedPage.sourceTotal !== snapshot.catalogTotal ||
                    capturedPage.pageLength !== expectedPage.count ||
                    capturedPage.hasMore !== expectedPage.hasMore ||
                    capturedPage.identityHash !== expectedPage.identityHash ||
                    capturedPage.contentHash !== expectedPage.contentHash ||
                    !Array.isArray(capturedPage.rows)
                  ) {
                    throw new Error(
                      `captured skills.sh leaderboard page does not match the proof: ${page}`,
                    );
                  }
                  const oidcToken = await getVercelOidcToken();
                  const catalogBatch = await fetchSkillsShMirrorBatch(
                    { page, offset, limit: MIRROR_BATCH_SIZE, maxDetailBytes: MAX_DETAIL_BYTES },
                    {
                      oidcToken,
                      beforeRequest,
                      sourcePage: {
                        data: capturedPage.rows as never,
                        pagination: {
                          page,
                          perPage: SOURCE_PAGE_SIZE,
                          total: snapshot.catalogTotal,
                          hasMore: expectedPage.hasMore,
                        },
                      },
                    },
                  );
                  if (catalogBatch.sourceTotal !== snapshot.catalogTotal) {
                    throw new Error("skills.sh catalog source total changed during the run");
                  }
                  if (
                    expectedPage.count !== catalogBatch.pageLength ||
                    expectedPage.hasMore !== catalogBatch.hasMore ||
                    expectedPage.identityHash !== catalogBatch.sourcePageIdentityHash
                  ) {
                    throw new Error(
                      `skills.sh ordered leaderboard page changed during the run: ${page}`,
                    );
                  }
                  const controlledOverlayExternalIds = new Set<string>(
                    snapshot.controlledOverlayExternalIds,
                  );
                  const overlayExternalIds = catalogBatch.rows.flatMap((row) =>
                    controlledOverlayExternalIds.has(row.externalId) ? [row.externalId] : [],
                  );
                  const overlay =
                    overlayExternalIds.length > 0
                      ? await fetchSkillsShMirrorControlledBatch(
                          {
                            page,
                            offset: 0,
                            limit: overlayExternalIds.length,
                            maxDetailBytes: MAX_DETAIL_BYTES,
                            sourceTotal,
                            externalIds: overlayExternalIds,
                          },
                          { beforeRequest },
                        )
                      : null;
                  const overlayByExternalId = new Map(
                    overlay?.rows.map((row) => [row.externalId, row]),
                  );
                  return {
                    ...catalogBatch,
                    sourceTotal,
                    hasMore:
                      catalogBatch.hasMore || snapshot.controlledSupplementExternalIds.length > 0,
                    sourceRequests: catalogBatch.sourceRequests + (overlay?.sourceRequests ?? 0),
                    sourceBytes: catalogBatch.sourceBytes + (overlay?.sourceBytes ?? 0),
                    rows: catalogBatch.rows.map((row) => {
                      const controlled = overlayByExternalId.get(row.externalId);
                      if (!controlled) return row;
                      if ("quarantined" in row) return controlled;
                      return {
                        ...controlled,
                        upstreamSourceType: row.upstreamSourceType,
                        upstreamInstalls: row.upstreamInstalls,
                        upstreamScanners: row.upstreamScanners,
                      };
                    }),
                  };
                })()
              : (() => {
                  throw new Error("skills.sh mirror cursor is beyond the proof source");
                })();
        const externalIds = batch.rows.flatMap((row) =>
          "quarantined" in row ? [] : [row.externalId],
        );
        const classificationState =
          externalIds.length === 0
            ? { states: [] }
            : await callConvexOperator(authorization, {
                operation: "mirror-classification-states",
                externalIds,
              });
        if (!Array.isArray(classificationState.states)) {
          throw new Error("Convex Test mirror classification state is invalid");
        }
        const rows = enrichSkillsShMirrorClassifications(
          batch.rows as Parameters<typeof enrichSkillsShMirrorClassifications>[0],
          classificationState.states as SkillsShMirrorClassificationState[],
        );
        return jsonResponse(
          await callConvexOperator(authorization, {
            operation: "mirror-batch",
            runId,
            leaseToken,
            ...batch,
            rows,
          }),
        );
      } catch (error) {
        try {
          await callConvexOperator(authorization, {
            operation: "mirror-batch-release",
            runId,
            page,
            offset,
            leaseToken,
          });
        } catch {
          // The five-minute durable lease remains the crash/outage recovery path.
        }
        throw error;
      }
    }
    if (operation === "step-replay") {
      const runId = requireString(body.runId, "runId");
      const page = requireInteger(body.page, "page", 0, 100_000);
      const offset = requireInteger(body.offset, "offset", 0, SOURCE_PAGE_SIZE - 1);
      const pageLength = requireInteger(body.pageLength, "pageLength", 1, SOURCE_PAGE_SIZE);
      const sourceTotal = requireInteger(body.sourceTotal, "sourceTotal", 1, MAX_TEST_SOURCE_ROWS);
      if (typeof body.hasMore !== "boolean") throw new Error("hasMore is required");
      if (
        !Array.isArray(body.externalIds) ||
        body.externalIds.length < 1 ||
        body.externalIds.length > MIRROR_BATCH_SIZE ||
        body.externalIds.some((externalId) => typeof externalId !== "string" || !externalId.trim())
      ) {
        throw new Error(`externalIds must contain between 1 and ${MIRROR_BATCH_SIZE} strings`);
      }
      const leaseToken = crypto.randomUUID();
      await callConvexOperator(authorization, {
        operation: "mirror-batch-claim",
        runId,
        page,
        offset,
        leaseToken,
      });
      try {
        const captured = await callConvexOperator(authorization, {
          operation: "mirror-replay-rows",
          externalIds: body.externalIds,
        });
        if (!Array.isArray(captured.rows)) {
          throw new Error("Convex Test mirror replay rows are invalid");
        }
        const rows = buildSkillsShMirrorReplayRows(captured.rows as never);
        return jsonResponse(
          await callConvexOperator(authorization, {
            operation: "mirror-batch",
            runId,
            page,
            offset,
            leaseToken,
            pageLength,
            hasMore: body.hasMore,
            sourceTotal,
            sourceRequests: 0,
            sourceBytes: 0,
            rows,
          }),
        );
      } catch (error) {
        try {
          await callConvexOperator(authorization, {
            operation: "mirror-batch-release",
            runId,
            page,
            offset,
            leaseToken,
          });
        } catch {
          // The five-minute durable lease remains the crash/outage recovery path.
        }
        throw error;
      }
    }
    if (operation === "pause" || operation === "resume") {
      return jsonResponse(
        await callConvexOperator(authorization, {
          operation: "mirror-pause",
          runId: requireString(body.runId, "runId"),
          paused: operation === "pause",
          reason: requireString(body.reason, "reason"),
          confirm: "set-skills-sh-mirror-pause",
        }),
      );
    }
    if (operation === "discard") {
      return jsonResponse(
        await callConvexOperator(authorization, {
          operation: "mirror-cancel",
          runId: requireString(body.runId, "runId"),
          reason: requireString(body.reason, "reason"),
          confirm: "cancel-skills-sh-mirror-test-run",
        }),
      );
    }
    if (operation === "reconcile") {
      return jsonResponse(
        await callConvexOperator(authorization, {
          operation: "mirror-reconcile",
          runId: requireString(body.runId, "runId"),
          limit: requireInteger(body.limit ?? 250, "limit", 1, 250),
        }),
      );
    }
    return jsonResponse({ error: "unknown_operation" }, 400);
  } catch (error) {
    const retryAfterSeconds = skillsShSourceRetryAfterSeconds(error);
    if (retryAfterSeconds !== null) {
      return jsonResponse(
        {
          error: "skills_sh_source_rate_limited",
          message: error instanceof Error ? error.message : "skills.sh source rate limited",
          retryAfterSeconds,
        },
        429,
        { "Retry-After": String(retryAfterSeconds) },
      );
    }
    return jsonResponse(
      {
        error: "skills_sh_mirror_test_failed",
        message: error instanceof Error ? error.message : "Unknown Test mirror failure",
      },
      502,
    );
  }
});
