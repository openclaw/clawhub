import { getVercelOidcToken } from "@vercel/oidc";
import { defineEventHandler, getHeader, readBody } from "h3";
import {
  fetchSkillsShCatalogPage,
  fetchSkillsShMirrorBatch,
  getSkillsShCatalogTestSourcePolicy,
} from "../../../skillsShCatalogSource";

const TEST_CONVEX_SITE_URL = "https://academic-chihuahua-392.convex.site";
const OPERATOR_PATH = "/api/v1/operator/skills-sh/catalog-test";
const SOURCE_PAGE_SIZE = 500;
const MIRROR_BATCH_SIZE = 50;
const MAX_MIRROR_ROWS = 10_000;
const MAX_DETAIL_BYTES = 64 * 1024;

type MirrorRequest = {
  operation?:
    | "configure"
    | "start"
    | "step"
    | "pause"
    | "resume"
    | "reconcile"
    | "status"
    | "isolation"
    | "read"
    | "page"
    | "detail-page";
  enabled?: boolean;
  externalId?: string;
  cursor?: string | null;
  limit?: number;
  offset?: number;
  page?: number;
  reason?: string;
  runId?: string;
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
    if (operation === "step") {
      const runId = requireString(body.runId, "runId");
      const page = requireInteger(body.page, "page", 0, 100_000);
      const offset = requireInteger(body.offset, "offset", 0, SOURCE_PAGE_SIZE - 1);
      const run = await callConvexOperator(authorization, {
        operation: "mirror-run",
        runId,
      });
      if (run.status !== "running") {
        throw new Error(`skills.sh mirror run is ${String(run.status ?? "missing")}`);
      }
      if (run.page !== page || run.offset !== offset) {
        throw new Error(
          `skills.sh mirror cursor mismatch: expected ${String(run.page)}:${String(run.offset)}`,
        );
      }
      const oidcToken = await getVercelOidcToken();
      const batch = await fetchSkillsShMirrorBatch(
        { page, offset, limit: MIRROR_BATCH_SIZE, maxDetailBytes: MAX_DETAIL_BYTES },
        { oidcToken },
      );
      return jsonResponse(
        await callConvexOperator(authorization, {
          operation: "mirror-batch",
          runId,
          ...batch,
        }),
      );
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
    return jsonResponse(
      {
        error: "skills_sh_mirror_test_failed",
        message: error instanceof Error ? error.message : "Unknown Test mirror failure",
      },
      502,
    );
  }
});
