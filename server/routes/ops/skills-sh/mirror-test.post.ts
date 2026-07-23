import { getVercelOidcToken } from "@vercel/oidc";
import { defineEventHandler, getHeader, readBody } from "h3";
import {
  fetchSkillsShCatalogPage,
  fetchSkillsShMirrorBatch,
  getSkillsShCatalogTestSourcePolicy,
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
const MAX_MIRROR_ROWS = 10_000;
const MAX_DETAIL_BYTES = 64 * 1024;
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
    | "reconcile"
    | "conflicts"
    | "status"
    | "isolation"
    | "read"
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
          limit: requireInteger(body.limit, "limit", 1, 500),
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
          maxRowsPerRun: MAX_MIRROR_ROWS,
          maxRowsPerBatch: MIRROR_BATCH_SIZE,
          maxDetailBytes: MAX_DETAIL_BYTES,
        }),
      );
    }
    if (operation === "start") {
      const oidcToken = await getVercelOidcToken();
      const sourceMeasuredAt = new Date().toISOString();
      const firstPage = await fetchSkillsShCatalogPage(
        { page: 0, perPage: SOURCE_PAGE_SIZE },
        { oidcToken },
      );
      if (firstPage.pagination.total < 1 || firstPage.pagination.total > MAX_MIRROR_ROWS) {
        throw new Error(
          `skills.sh source total ${firstPage.pagination.total} exceeds the Test mirror capacity`,
        );
      }
      const result = await callConvexOperator(authorization, {
        operation: "mirror-start",
        reason: requireString(body.reason, "reason"),
        snapshotId: `skills-sh:${sourceMeasuredAt}:${firstPage.pagination.total}`,
        sourceTotal: firstPage.pagination.total,
        sourcePageSize: SOURCE_PAGE_SIZE,
        sourceMeasuredAt,
      });
      return jsonResponse({
        ...result,
        sourceTotal: firstPage.pagination.total,
        sourceMeasuredAt,
        sourcePageSize: SOURCE_PAGE_SIZE,
      });
    }
    if (operation === "start-replay") {
      const sourceMeasuredAt = requireString(body.sourceMeasuredAt, "sourceMeasuredAt");
      if (Number.isNaN(Date.parse(sourceMeasuredAt))) {
        throw new Error("sourceMeasuredAt must be an ISO timestamp");
      }
      const sourceTotal = requireInteger(body.sourceTotal, "sourceTotal", 1, MAX_MIRROR_ROWS);
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
      await callConvexOperator(authorization, {
        operation: "mirror-batch-claim",
        runId,
        page,
        offset,
        leaseToken,
      });
      try {
        const oidcToken = await getVercelOidcToken();
        const beforeRequest = createBatchLeaseHeartbeat({
          authorization,
          runId,
          page,
          offset,
          leaseToken,
        });
        const batch = await fetchSkillsShMirrorBatch(
          { page, offset, limit: MIRROR_BATCH_SIZE, maxDetailBytes: MAX_DETAIL_BYTES },
          { oidcToken, beforeRequest },
        );
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
          batch.rows,
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
      const sourceTotal = requireInteger(body.sourceTotal, "sourceTotal", 1, MAX_MIRROR_ROWS);
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
