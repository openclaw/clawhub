import { requireAuthToken } from "../../../clawhub/src/cli/authToken.js";
import { getRegistry } from "../../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import { fail } from "../../../clawhub/src/cli/ui.js";
import { apiRequest, registryUrl } from "../../../clawhub/src/http.js";
import {
  ApiRoutes,
  ApiV1SecurityScanArtifactListResponseSchema,
  ApiV1SecurityScanArtifactResponseSchema,
  ApiV1SecurityScanOverviewResponseSchema,
  parseArk,
} from "../../../clawhub/src/schema/index.js";

const ARTIFACT_KINDS = ["skill", "plugin"] as const;
const ARTIFACT_KIND_ARGS = ["all", ...ARTIFACT_KINDS] as const;
const CLAW_SCAN_VERDICTS = ["pass", "suspicious", "malicious", "pending", "failed", "unknown"];
const PIPELINE_STATUSES = ["none", "queued", "running", "succeeded", "failed"];
const FAILURE_STATUSES = ["none", "failed"];
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;

type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
type ArtifactKindArg = (typeof ARTIFACT_KIND_ARGS)[number];
type OverviewResponse = Record<string, unknown>;
type ArtifactListResponse = {
  items: SecurityScanArtifactSummary[];
  nextCursor: string | null;
  done: boolean;
  limit: number;
};
type ArtifactDetailResponse = Record<string, unknown> & {
  found?: boolean;
  artifactKind?: ArtifactKind;
  state?: SecurityScanArtifactSummary | null;
  evidence?: Record<string, unknown>;
  scanJob?: Record<string, unknown> | null;
};
type SecurityScanArtifactSummary = Record<string, unknown> & {
  artifactKind?: ArtifactKind;
  slug?: string;
  name?: string;
  displayName?: string;
  version?: string;
  artifactKey?: string;
  clawScanVerdict?: string;
  clawScanStatus?: string;
  clawScanPrimaryCategoryKey?: string;
  clawScanPrimaryCategoryLabel?: string;
  scanJobStatus?: string;
  failureStatus?: string;
  lastError?: string;
  skillSpectorScore?: number;
  skillSpectorTopCategory?: string;
  updatedAt?: number;
};

export type SecurityScanOverviewOptions = {
  artifactKind?: string;
  windowHours?: string | number;
  failedLimit?: string | number;
  json?: boolean;
};

export type SecurityScanListOptions = {
  artifactKind?: string;
  verdict?: string;
  clawScanVerdict?: string;
  scanJobStatus?: string;
  failureStatus?: string;
  category?: string;
  clawScanPrimaryCategoryKey?: string;
  cursor?: string;
  limit?: string | number;
  json?: boolean;
};

export type SecurityScanInspectOptions = {
  skill?: string;
  plugin?: string;
  json?: boolean;
};

export async function cmdSecurityScanOverview(
  opts: GlobalOpts,
  options: SecurityScanOverviewOptions = {},
) {
  const artifactKind = normalizeArtifactKindArg(options.artifactKind ?? "all");
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const url = registryUrl(`${ApiRoutes.securityScans}/overview`, registry);
  if (artifactKind !== "all") url.searchParams.set("artifactKind", artifactKind);
  setOptionalNumber(url, "windowHours", options.windowHours);
  setOptionalNumber(url, "failedLimit", options.failedLimit);

  const raw = await apiRequest(
    registry,
    { method: "GET", url: url.toString(), token },
    ApiV1SecurityScanOverviewResponseSchema,
  );
  const result = parseArk(
    ApiV1SecurityScanOverviewResponseSchema,
    raw,
    "Security scan overview response",
  ) as OverviewResponse;

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }

  printOverview(result, { registry, artifactKind });
  return result;
}

export async function cmdListSecurityScanArtifacts(
  opts: GlobalOpts,
  options: SecurityScanListOptions = {},
) {
  const artifactKind = normalizeArtifactKindArg(options.artifactKind ?? "all");
  const listOptions = normalizeListOptions(options);
  const limit = clampLimit(options.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);

  if (artifactKind === "all" && listOptions.cursor) {
    fail("--cursor requires --artifact-kind skill or --artifact-kind plugin");
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const kinds = artifactKind === "all" ? [...ARTIFACT_KINDS] : [artifactKind];
  const pages: Record<string, ArtifactListResponse> = {};
  const items: SecurityScanArtifactSummary[] = [];

  for (const kind of kinds) {
    const page = await fetchArtifactList(registry, token, kind, { ...listOptions, limit });
    pages[kind] = page;
    items.push(...page.items);
  }

  const sortedItems = items
    .sort((a, b) => asNumber(b.updatedAt) - asNumber(a.updatedAt))
    .slice(0, limit);
  const result =
    artifactKind === "all"
      ? {
          artifactKind,
          items: sortedItems,
          nextCursor: null,
          done: Object.values(pages).every((page) => page.done),
          limit,
          pages,
        }
      : {
          artifactKind,
          ...pages[artifactKind],
        };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }

  printArtifactList(sortedItems, result);
  return result;
}

export async function cmdListFailedSecurityScans(
  opts: GlobalOpts,
  options: Omit<SecurityScanListOptions, "failureStatus"> = {},
) {
  return await cmdListSecurityScanArtifacts(opts, { ...options, failureStatus: "failed" });
}

export async function cmdListQueuedSecurityScans(
  opts: GlobalOpts,
  options: Omit<SecurityScanListOptions, "scanJobStatus"> = {},
) {
  return await cmdListSecurityScanArtifacts(opts, { ...options, scanJobStatus: "queued" });
}

export async function cmdListRunningSecurityScans(
  opts: GlobalOpts,
  options: Omit<SecurityScanListOptions, "scanJobStatus"> = {},
) {
  return await cmdListSecurityScanArtifacts(opts, { ...options, scanJobStatus: "running" });
}

export async function cmdInspectSecurityScanArtifact(
  opts: GlobalOpts,
  options: SecurityScanInspectOptions = {},
) {
  const skillSlug = options.skill?.trim();
  const packageName = options.plugin?.trim();
  if (Boolean(skillSlug) === Boolean(packageName)) {
    fail("Pass exactly one of --skill or --plugin");
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const url = registryUrl(`${ApiRoutes.securityScans}/artifact`, registry);
  if (skillSlug) url.searchParams.set("skillSlug", skillSlug);
  if (packageName) url.searchParams.set("packageName", packageName);
  const raw = await apiRequest(
    registry,
    { method: "GET", url: url.toString(), token },
    ApiV1SecurityScanArtifactResponseSchema,
  );
  const result = parseArk(
    ApiV1SecurityScanArtifactResponseSchema,
    raw,
    "Security scan artifact response",
  ) as ArtifactDetailResponse;

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }

  printArtifactDetail(result, skillSlug ?? packageName ?? "artifact");
  return result;
}

async function fetchArtifactList(
  registry: string,
  token: string,
  artifactKind: ArtifactKind,
  options: NormalizedListOptions,
) {
  const url = registryUrl(`${ApiRoutes.securityScans}/artifacts`, registry);
  url.searchParams.set("artifactKind", artifactKind);
  if (options.cursor) url.searchParams.set("cursor", options.cursor);
  url.searchParams.set("limit", String(options.limit));
  if (options.clawScanVerdict) url.searchParams.set("clawScanVerdict", options.clawScanVerdict);
  if (options.scanJobStatus) url.searchParams.set("scanJobStatus", options.scanJobStatus);
  if (options.failureStatus) url.searchParams.set("failureStatus", options.failureStatus);
  if (options.clawScanPrimaryCategoryKey) {
    url.searchParams.set("clawScanPrimaryCategoryKey", options.clawScanPrimaryCategoryKey);
  }

  const raw = await apiRequest(
    registry,
    { method: "GET", url: url.toString(), token },
    ApiV1SecurityScanArtifactListResponseSchema,
  );
  return parseArk(
    ApiV1SecurityScanArtifactListResponseSchema,
    raw,
    "Security scan artifact list response",
  ) as ArtifactListResponse;
}

type NormalizedListOptions = {
  cursor?: string;
  limit: number;
  clawScanVerdict?: string;
  scanJobStatus?: string;
  failureStatus?: string;
  clawScanPrimaryCategoryKey?: string;
};

function normalizeListOptions(options: SecurityScanListOptions): NormalizedListOptions {
  const clawScanVerdict = normalizeEnum(
    options.clawScanVerdict ?? options.verdict,
    CLAW_SCAN_VERDICTS,
    "--verdict",
  );
  const scanJobStatus = normalizeEnum(
    options.scanJobStatus,
    PIPELINE_STATUSES,
    "--scan-job-status",
  );
  const failureStatus = normalizeEnum(options.failureStatus, FAILURE_STATUSES, "--failure-status");
  const clawScanPrimaryCategoryKey = normalizeOptionalString(
    options.clawScanPrimaryCategoryKey ?? options.category,
  );
  const filterCount = [
    clawScanVerdict,
    scanJobStatus,
    failureStatus,
    clawScanPrimaryCategoryKey,
  ].filter(Boolean).length;
  if (filterCount > 1) {
    fail("Pass at most one of --verdict, --scan-job-status, --failure-status, or --category");
  }
  return {
    cursor: normalizeOptionalString(options.cursor),
    limit: clampLimit(options.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT),
    clawScanVerdict,
    scanJobStatus,
    failureStatus,
    clawScanPrimaryCategoryKey,
  };
}

function printOverview(
  result: OverviewResponse,
  context: { registry: string; artifactKind: ArtifactKindArg },
) {
  const window = asRecord(result.window);
  const current = asRecord(result.current);
  const kinds = ARTIFACT_KINDS.filter((kind) => current[kind]);
  const totals = aggregateCurrentTotals(current);
  const hours = asNumber(window.hours) || 24;

  console.log(`Security scan overview (${formatKindArg(context.artifactKind)}, last ${hours}h)`);
  console.log(`Registry: ${context.registry}`);
  console.log(`Current artifacts: ${totals.total}`);
  console.log("");
  console.log("Verdicts");
  for (const verdict of CLAW_SCAN_VERDICTS) {
    const count = totals.byVerdict[verdict] ?? 0;
    console.log(`  ${verdict}: ${formatCountPercent(count, totals.total)}`);
  }
  console.log("");
  console.log("Pipeline");
  for (const status of PIPELINE_STATUSES) {
    const count = totals.byScanJobStatus[status] ?? 0;
    console.log(`  ${status}: ${count}`);
  }
  console.log("");
  console.log("Artifact kinds");
  for (const kind of kinds) {
    const totalsForKind = asRecord(asRecord(current[kind]).totals);
    const total = asNumber(totalsForKind.total);
    const pass = asNumber(asRecord(totalsForKind.byVerdict).pass);
    console.log(`  ${kind}: ${total} artifacts, pass ${formatCountPercent(pass, total)}`);
  }

  const windowTotals = aggregateWindowTotals(asRecord(window.totalsByKind));
  console.log("");
  console.log("Recent window");
  console.log(`  scan events: ${windowTotals.total}`);
  console.log(`  queued: ${windowTotals.byScanJobStatus.queued ?? 0}`);
  console.log(`  running: ${windowTotals.byScanJobStatus.running ?? 0}`);
  console.log(`  succeeded: ${windowTotals.byScanJobStatus.succeeded ?? 0}`);
  console.log(`  failed: ${windowTotals.byScanJobStatus.failed ?? 0}`);

  const categories = collectCategoryRows(current).slice(0, 8);
  console.log("");
  console.log("ClawScan categories");
  if (categories.length === 0) {
    console.log("  none");
  } else {
    for (const row of categories) {
      const label = row.categoryLabel ?? row.categoryKey ?? "uncategorized";
      const count = asNumber(row.count);
      const total = asNumber(row.totalForKind ?? row.percentageBasis ?? totals.total);
      console.log(
        `  ${label}: ${formatCountPercent(count, total)} ${row.artifactKind} ${row.clawScanVerdict}`,
      );
    }
  }

  const failedItems = asArray(asRecord(result.failed).items) as SecurityScanArtifactSummary[];
  console.log("");
  console.log("Failed scans");
  if (failedItems.length === 0) {
    console.log("  none");
  } else {
    for (const item of failedItems) console.log(`  ${formatArtifactRow(item)}`);
  }
}

function printArtifactList(
  items: SecurityScanArtifactSummary[],
  page: { nextCursor?: string | null; done?: boolean; artifactKind?: string },
) {
  if (items.length === 0) {
    console.log("No security scan artifacts matched.");
    return;
  }
  for (const item of items) {
    console.log(formatArtifactRow(item));
    const category = item.clawScanPrimaryCategoryLabel ?? item.clawScanPrimaryCategoryKey;
    if (category) console.log(`  category: ${category}`);
    if (typeof item.skillSpectorScore === "number") {
      console.log(
        `  SkillSpector: score=${item.skillSpectorScore}${item.skillSpectorTopCategory ? ` category=${item.skillSpectorTopCategory}` : ""}`,
      );
    }
    if (item.lastError) console.log(`  error: ${item.lastError}`);
    if (item.updatedAt) console.log(`  updated: ${formatDate(item.updatedAt)}`);
  }
  if (!page.done && page.nextCursor) console.log(`Next cursor: ${page.nextCursor}`);
  if (page.artifactKind === "all") {
    console.log("Use --artifact-kind skill or --artifact-kind plugin to paginate with --cursor.");
  }
}

function printArtifactDetail(result: ArtifactDetailResponse, label: string) {
  if (result.found === false) {
    console.log(`No security scan artifact found for ${label}.`);
    return;
  }
  const state = asRecord(result.state);
  const scanJob = asRecord(result.scanJob);
  const evidence = asRecord(result.evidence);
  console.log(`Security scan artifact: ${formatArtifactTitle(state)}`);
  if (Object.keys(state).length === 0) {
    console.log("Digest state: none yet");
  } else {
    console.log(`ClawScan verdict: ${asDisplayString(state.clawScanVerdict)}`);
    console.log(`Pipeline status: ${asDisplayString(state.scanJobStatus, "none")}`);
    console.log(`Failure status: ${asDisplayString(state.failureStatus, "none")}`);
    const category =
      optionalDisplayString(state.clawScanPrimaryCategoryLabel) ??
      optionalDisplayString(state.clawScanPrimaryCategoryKey);
    if (category) console.log(`Category: ${category}`);
    const summary = optionalDisplayString(state.clawScanSummary);
    if (summary) console.log(`Summary: ${summary}`);
    const lastError = optionalDisplayString(state.lastError);
    if (lastError) console.log(`Last error: ${lastError}`);
  }

  const clawScan = asRecord(evidence.clawScan);
  console.log("");
  console.log("ClawScan evidence");
  console.log(`  status: ${asDisplayString(clawScan.status)}`);
  console.log(`  verdict: ${asDisplayString(clawScan.verdict)}`);
  const confidence = optionalDisplayString(clawScan.confidence);
  if (confidence) console.log(`  confidence: ${confidence}`);
  const clawSummary = optionalDisplayString(clawScan.summary);
  if (clawSummary) console.log(`  summary: ${clawSummary}`);

  const skillSpector = asRecord(evidence.skillSpector);
  console.log("");
  console.log("SkillSpector evidence");
  console.log(`  status: ${asDisplayString(skillSpector.status)}`);
  if (typeof skillSpector.score === "number") console.log(`  score: ${skillSpector.score}`);
  const severity = optionalDisplayString(skillSpector.severity);
  if (severity) console.log(`  severity: ${severity}`);
  const recommendation = optionalDisplayString(skillSpector.recommendation);
  if (recommendation) console.log(`  recommendation: ${recommendation}`);

  const staticScan = asRecord(evidence.staticScan);
  const virusTotal = asRecord(evidence.virusTotal);
  console.log("");
  console.log("Other evidence");
  console.log(`  static: ${asDisplayString(staticScan.status)}`);
  console.log(`  VirusTotal: ${asDisplayString(virusTotal.verdict ?? virusTotal.status)}`);
  if (Object.keys(scanJob).length > 0) {
    console.log("");
    console.log("Worker");
    console.log(`  job: ${asDisplayString(scanJob._id)}`);
    console.log(`  status: ${asDisplayString(scanJob.status)}`);
    const workerId = optionalDisplayString(scanJob.workerId);
    if (workerId) console.log(`  worker: ${workerId}`);
    const error = optionalDisplayString(scanJob.lastError);
    if (error) console.log(`  error: ${error}`);
  }
}

function aggregateCurrentTotals(current: Record<string, unknown>) {
  const totals = emptyAggregate();
  for (const kind of ARTIFACT_KINDS) {
    const kindTotals = asRecord(asRecord(current[kind]).totals);
    addCounts(totals, kindTotals);
  }
  return totals;
}

function aggregateWindowTotals(totalsByKind: Record<string, unknown>) {
  const totals = emptyAggregate();
  for (const kind of ARTIFACT_KINDS) {
    addCounts(totals, asRecord(totalsByKind[kind]));
  }
  return totals;
}

function emptyAggregate() {
  return {
    total: 0,
    byVerdict: Object.fromEntries(CLAW_SCAN_VERDICTS.map((verdict) => [verdict, 0])),
    byScanJobStatus: Object.fromEntries(PIPELINE_STATUSES.map((status) => [status, 0])),
  } as {
    total: number;
    byVerdict: Record<string, number>;
    byScanJobStatus: Record<string, number>;
  };
}

function addCounts(target: ReturnType<typeof emptyAggregate>, source: Record<string, unknown>) {
  target.total += asNumber(source.total);
  const verdicts = asRecord(source.byVerdict);
  const statuses = asRecord(source.byScanJobStatus);
  for (const verdict of CLAW_SCAN_VERDICTS)
    target.byVerdict[verdict] += asNumber(verdicts[verdict]);
  for (const status of PIPELINE_STATUSES) {
    target.byScanJobStatus[status] += asNumber(statuses[status]);
  }
}

function collectCategoryRows(current: Record<string, unknown>) {
  const rows: Array<Record<string, string | number | undefined>> = [];
  for (const kind of ARTIFACT_KINDS) {
    const rollups = asArray(asRecord(current[kind]).rollups);
    for (const row of rollups) {
      const record = asRecord(row);
      if (record.rollupKind !== "clawscanCategory") continue;
      rows.push({
        artifactKind: typeof record.artifactKind === "string" ? record.artifactKind : kind,
        categoryKey: typeof record.categoryKey === "string" ? record.categoryKey : undefined,
        categoryLabel: typeof record.categoryLabel === "string" ? record.categoryLabel : undefined,
        clawScanVerdict:
          typeof record.clawScanVerdict === "string" ? record.clawScanVerdict : undefined,
        count: asNumber(record.count),
        totalForKind: asNumber(record.totalForKind),
        percentageBasis: asNumber(record.percentageBasis),
      });
    }
  }
  return rows.sort((a, b) => asNumber(b.count) - asNumber(a.count));
}

function normalizeArtifactKindArg(value: string): ArtifactKindArg {
  const normalized = value.trim().toLowerCase();
  if (ARTIFACT_KIND_ARGS.includes(normalized as ArtifactKindArg)) {
    return normalized as ArtifactKindArg;
  }
  return fail("--artifact-kind must be all, skill, or plugin");
}

function normalizeEnum(value: string | undefined, allowed: readonly string[], flag: string) {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  if (!normalized) return undefined;
  if (allowed.includes(normalized)) return normalized;
  return fail(`${flag} must be one of ${allowed.join("|")}`);
}

function normalizeOptionalString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function setOptionalNumber(url: URL, name: string, value: string | number | undefined) {
  if (value === undefined) return;
  url.searchParams.set(name, String(clampPositiveInt(value, name)));
}

function clampLimit(value: string | number | undefined, fallback: number, max: number) {
  if (value === undefined) return fallback;
  return clampPositiveInt(value, "limit", max);
}

function clampPositiveInt(value: string | number, label: string, max = 10_000) {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) fail(`${label} must be a positive integer`);
  return Math.min(max, Math.floor(parsed));
}

function formatKindArg(kind: ArtifactKindArg) {
  if (kind === "all") return "skills and plugins";
  return kind === "skill" ? "skills" : "plugins";
}

function formatCountPercent(count: number, total: number) {
  if (total <= 0) return `${count}/0 (0%)`;
  return `${count}/${total} (${Math.round((count / total) * 100)}%)`;
}

function formatArtifactRow(item: SecurityScanArtifactSummary) {
  const title = formatArtifactTitle(item);
  const version = item.version ? `@${item.version}` : "";
  const verdict = item.clawScanVerdict ?? "unknown";
  const job = item.scanJobStatus ?? "none";
  const failure = item.failureStatus === "failed" ? " failure=failed" : "";
  return `${item.artifactKind ?? "artifact"} ${title}${version} verdict=${verdict} job=${job}${failure}`;
}

function formatArtifactTitle(item: Record<string, unknown>) {
  const displayName = typeof item.displayName === "string" ? item.displayName : undefined;
  const slug = typeof item.slug === "string" ? item.slug : undefined;
  const name = typeof item.name === "string" ? item.name : undefined;
  const artifactKey = typeof item.artifactKey === "string" ? item.artifactKey : undefined;
  return displayName ?? slug ?? name ?? artifactKey ?? "unknown";
}

function formatDate(value: number) {
  return new Date(value).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function optionalDisplayString(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function asDisplayString(value: unknown, fallback = "unknown") {
  return optionalDisplayString(value) ?? fallback;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
