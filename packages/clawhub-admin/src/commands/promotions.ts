import { readFile } from "node:fs/promises";
import { requireAuthToken } from "../../../clawhub/src/cli/authToken.js";
import { getRegistry } from "../../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import { createCrabLoader, fail, formatError } from "../../../clawhub/src/cli/ui.js";
import { apiRequest } from "../../../clawhub/src/http.js";
import {
  ApiRoutes,
  ApiV1PromotionsListResponseSchema,
  ApiV1PromotionWriteResponseSchema,
  parseArk,
  type ApiV1Promotion,
} from "../../../clawhub/src/schema/index.js";

const PROMOTION_STATUSES = ["draft", "active", "ended"] as const;
type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

function normalizeSlugOrFail(raw: string) {
  const slug = raw.trim().toLowerCase();
  if (!slug) fail("Promotion slug required");
  return slug;
}

async function readPromotionInputFile(file: string) {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    return fail(`Unable to read ${file}: ${formatError(error)}`);
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return fail(`${file} is not valid JSON`);
  }
}

function formatPromotionLine(promotion: ApiV1Promotion) {
  const window = `${new Date(promotion.startsAt).toISOString().slice(0, 10)} → ${new Date(
    promotion.endsAt,
  )
    .toISOString()
    .slice(0, 10)}`;
  const state = promotion.active ? "active" : promotion.status;
  const models = promotion.models.map((model) => model.modelRef).join(", ");
  return `${promotion.slug}  [${state}]  ${window}  ${promotion.title}  (${models})`;
}

export async function cmdListPromotions(
  opts: GlobalOpts,
  options: { all?: boolean; json?: boolean },
) {
  const registry = await getRegistry(opts, { cache: true });
  const token = options.all ? await requireAuthToken() : undefined;
  const promotions: ApiV1Promotion[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  do {
    const requestPath: string = options.all
      ? `${ApiRoutes.promotions}?status=all&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
      : ApiRoutes.promotions;
    const result: unknown = await apiRequest(
      registry,
      { method: "GET", path: requestPath, ...(token ? { token } : {}) },
      ApiV1PromotionsListResponseSchema,
    );
    const page: {
      promotions: ApiV1Promotion[];
      nextCursor?: string | null;
    } = parseArk(ApiV1PromotionsListResponseSchema, result, "Promotions response");
    promotions.push(...page.promotions);
    cursor = options.all ? (page.nextCursor ?? null) : null;
    if (cursor && seenCursors.has(cursor)) {
      fail("Promotions response repeated a pagination cursor");
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);

  const parsed = { promotions };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
    return parsed;
  }
  if (parsed.promotions.length === 0) {
    console.log(options.all ? "No promotions." : "No active promotions.");
    return parsed;
  }
  for (const promotion of parsed.promotions) {
    console.log(formatPromotionLine(promotion));
  }
  return parsed;
}

export async function cmdCreatePromotion(
  opts: GlobalOpts,
  file: string,
  options: { json?: boolean },
) {
  const body = await readPromotionInputFile(file);
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });

  const spinner = options.json ? null : createCrabLoader("Creating promotion");
  try {
    const result = await apiRequest(
      registry,
      { method: "POST", path: ApiRoutes.promotions, token, body },
      ApiV1PromotionWriteResponseSchema,
    );
    spinner?.succeed(
      `Created promotion "${result.slug}" (status: ${result.status}). Activate with: clawhub-admin promotions set-status ${result.slug} active`,
    );
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

export async function cmdUpdatePromotion(
  opts: GlobalOpts,
  slugArg: string,
  file: string,
  options: { json?: boolean },
) {
  const slug = normalizeSlugOrFail(slugArg);
  const body = await readPromotionInputFile(file);
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });

  const spinner = options.json ? null : createCrabLoader(`Updating promotion ${slug}`);
  try {
    const result = await apiRequest(
      registry,
      { method: "POST", path: `${ApiRoutes.promotions}/${slug}/update`, token, body },
      ApiV1PromotionWriteResponseSchema,
    );
    spinner?.succeed(`Updated promotion "${result.slug}" (status: ${result.status})`);
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

export async function cmdSetPromotionStatus(
  opts: GlobalOpts,
  slugArg: string,
  statusArg: string,
  options: { json?: boolean },
) {
  const slug = normalizeSlugOrFail(slugArg);
  const status = statusArg.trim().toLowerCase() as PromotionStatus;
  if (!PROMOTION_STATUSES.includes(status)) {
    fail(`Status must be one of: ${PROMOTION_STATUSES.join(", ")}`);
  }
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });

  const spinner = options.json ? null : createCrabLoader(`Setting ${slug} to ${status}`);
  try {
    const result = await apiRequest(
      registry,
      { method: "POST", path: `${ApiRoutes.promotions}/${slug}/status`, token, body: { status } },
      ApiV1PromotionWriteResponseSchema,
    );
    spinner?.succeed(`Promotion "${result.slug}" is now ${result.status}`);
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}
