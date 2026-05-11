import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction } from "./functions";
import {
  assembleCommentScamEvalUserMessage,
  COMMENT_SCAM_EVALUATOR_SYSTEM_PROMPT,
  COMMENT_SCAM_EVAL_MAX_OUTPUT_TOKENS,
  getCommentScamEvalModel,
  parseCommentScamEvalResponse,
} from "./lib/commentScamPrompt";
import { extractResponseText } from "./lib/openaiResponse";
import type { SkillEvalContext } from "./lib/securityPrompt";
import {
  assembleEvalUserMessage,
  assembleSkillEvalUserMessage,
  applyInjectionSignalFloor,
  detectInjectionPatterns,
  getLlmEvalModel,
  getLlmEvalReasoningEffort,
  getLlmEvalServiceTier,
  LLM_EVAL_MAX_OUTPUT_TOKENS,
  parseLlmEvalResponse,
  SKILL_SECURITY_EVALUATOR_SYSTEM_PROMPT,
} from "./lib/securityPrompt";

const internalRefs = internal as unknown as {
  packages: {
    getReleaseByIdInternal: unknown;
    getPackageByIdInternal: unknown;
    updateReleaseLlmAnalysisInternal: unknown;
    getSuspiciousPluginReleaseBatchForLlmRescanInternal: unknown;
    getPluginScanStatusCountPageInternal: unknown;
  };
  skills: {
    getSuspiciousSkillBatchForLlmRescanInternal: unknown;
    getSuspiciousSkillCountPageInternal: unknown;
  };
  llmEval: {
    evaluateWithLlm: unknown;
    evaluatePackageReleaseWithLlm: unknown;
    scheduleSuspiciousSkillLlmRescanInternal: unknown;
    scheduleSuspiciousPluginLlmRescanInternal: unknown;
  };
};

const llmEvalModerationModeValidator = v.optional(
  v.union(v.literal("normal"), v.literal("preserve")),
);

type LlmEvalModerationMode = "normal" | "preserve";
type JsonRecord = Record<string, unknown>;

const MAX_PACKAGE_ENV_DECLARATIONS = 50;
const MAX_PACKAGE_CONFIG_DECLARATIONS = 50;
const MAX_PACKAGE_ENV_VALUE_LENGTH = 200;

async function runQueryRef<T>(
  ctx: { runQuery: (ref: never, args: never) => Promise<unknown> },
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runQuery(ref as never, args as never)) as T;
}

async function runMutationRef<T>(
  ctx: { runMutation: (ref: never, args: never) => Promise<unknown> },
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runMutation(ref as never, args as never)) as T;
}

async function runAfterRef(
  ctx: { scheduler: { runAfter: (delayMs: number, ref: never, args: never) => Promise<unknown> } },
  delayMs: number,
  ref: unknown,
  args: unknown,
): Promise<void> {
  await ctx.scheduler.runAfter(delayMs, ref as never, args as never);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizePackageEnvironmentValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let normalized = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 32 && code !== 127) normalized += value[index];
  }
  normalized = normalized.trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_PACKAGE_ENV_VALUE_LENGTH);
}

function normalizePackageEnvironmentStringList(input: unknown, limit: number): string[] {
  const rawItems = Array.isArray(input) ? input : typeof input === "string" ? [input] : [];
  const items: string[] = [];
  const seen = new Set<string>();
  for (const rawItem of rawItems) {
    const value = isRecord(rawItem) ? rawItem.name : rawItem;
    const normalized = sanitizePackageEnvironmentValue(value);
    if (!normalized || seen.has(normalized)) continue;
    items.push(normalized);
    seen.add(normalized);
    if (items.length >= limit) break;
  }
  return items;
}

function normalizePackageEnvironmentEnvVars(input: unknown): Array<{
  name: string;
  required?: boolean;
  description?: string;
}> {
  const rawItems = Array.isArray(input) ? input : typeof input === "string" ? [input] : [];
  const envVars: Array<{ name: string; required?: boolean; description?: string }> = [];
  const seen = new Set<string>();
  for (const rawItem of rawItems) {
    const name = sanitizePackageEnvironmentValue(isRecord(rawItem) ? rawItem.name : rawItem);
    if (!name || seen.has(name)) continue;
    const envVar: { name: string; required?: boolean; description?: string } = { name };
    if (isRecord(rawItem)) {
      if (typeof rawItem.required === "boolean") envVar.required = rawItem.required;
      const description = sanitizePackageEnvironmentValue(rawItem.description);
      if (description) envVar.description = description;
    }
    envVars.push(envVar);
    seen.add(name);
    if (envVars.length >= MAX_PACKAGE_ENV_DECLARATIONS) break;
  }
  return envVars;
}

export function packageOpenClawEnvironmentForPrompt(packageJson: unknown): JsonRecord | undefined {
  if (!isRecord(packageJson)) return undefined;
  const openclaw = isRecord(packageJson.openclaw) ? packageJson.openclaw : undefined;
  const environment = isRecord(openclaw?.environment) ? openclaw.environment : undefined;
  if (!environment) return undefined;

  const requiredEnv = normalizePackageEnvironmentStringList(
    environment.requiredEnv ?? environment.env,
    MAX_PACKAGE_ENV_DECLARATIONS,
  );
  const optionalEnv = normalizePackageEnvironmentStringList(
    environment.optionalEnv,
    MAX_PACKAGE_ENV_DECLARATIONS,
  );
  const declaredEnvVars = normalizePackageEnvironmentEnvVars(environment.envVars);
  const config = normalizePackageEnvironmentStringList(
    environment.configPaths ?? environment.config,
    MAX_PACKAGE_CONFIG_DECLARATIONS,
  );
  const primaryEnv = sanitizePackageEnvironmentValue(environment.primaryEnv);

  const envVars = [
    ...requiredEnv.map((name) => ({ name, required: true })),
    ...optionalEnv.map((name) => ({ name, required: false })),
    ...declaredEnvVars,
  ];
  const dedupedEnvVars = envVars.filter(
    (envVar, index) => envVars.findIndex((candidate) => candidate.name === envVar.name) === index,
  );
  const requires: JsonRecord = {};
  if (requiredEnv.length > 0) requires.env = requiredEnv;
  if (config.length > 0) requires.config = config;

  const openclawMetadata: JsonRecord = {};
  if (Object.keys(requires).length > 0) openclawMetadata.requires = requires;
  if (dedupedEnvVars.length > 0) openclawMetadata.envVars = dedupedEnvVars;
  if (primaryEnv) openclawMetadata.primaryEnv = primaryEnv;

  return Object.keys(openclawMetadata).length > 0 ? openclawMetadata : undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function verdictToStatus(verdict: string): string {
  switch (verdict) {
    case "benign":
      return "clean";
    case "malicious":
      return "malicious";
    case "suspicious":
      return "suspicious";
    default:
      return "pending";
  }
}

// ---------------------------------------------------------------------------
// Publish-time evaluation action
// ---------------------------------------------------------------------------

export const evaluateWithLlm = internalAction({
  args: {
    versionId: v.id("skillVersions"),
    moderationMode: llmEvalModerationModeValidator,
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.log("[llmEval] OPENAI_API_KEY not configured, skipping evaluation");
      return;
    }

    const model = getLlmEvalModel();
    const reasoningEffort = getLlmEvalReasoningEffort();
    const serviceTier = getLlmEvalServiceTier();

    // Store error helper
    const storeError = async (message: string) => {
      console.error(`[llmEval] ${message}`);
      await ctx.runMutation(internal.skills.updateVersionLlmAnalysisInternal, {
        versionId: args.versionId,
        ...(args.moderationMode ? { moderationMode: args.moderationMode } : {}),
        llmAnalysis: {
          status: "error",
          summary: message,
          model,
          checkedAt: Date.now(),
        },
      });
    };

    // 1. Fetch version
    const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
      versionId: args.versionId,
    })) as Doc<"skillVersions"> | null;

    if (!version) {
      await storeError(`Version ${args.versionId} not found`);
      return;
    }

    // 2. Fetch skill
    const skill = (await ctx.runQuery(internal.skills.getSkillByIdInternal, {
      skillId: version.skillId,
    })) as Doc<"skills"> | null;

    if (!skill) {
      await storeError(`Skill ${version.skillId} not found`);
      return;
    }

    // 3. Read SKILL.md content
    const skillMdFile = version.files.find((f) => {
      const lower = f.path.toLowerCase();
      return lower === "skill.md" || lower === "skills.md";
    });

    let skillMdContent = "";
    if (skillMdFile) {
      const blob = await ctx.storage.get(skillMdFile.storageId as Id<"_storage">);
      if (blob) {
        skillMdContent = await blob.text();
      }
    }

    if (!skillMdContent) {
      await storeError("No SKILL.md content found");
      return;
    }

    // 4. Read all file contents
    const fileContents: Array<{ path: string; content: string }> = [];
    for (const f of version.files) {
      const lower = f.path.toLowerCase();
      if (lower === "skill.md" || lower === "skills.md") continue;
      try {
        const blob = await ctx.storage.get(f.storageId as Id<"_storage">);
        if (blob) {
          fileContents.push({ path: f.path, content: await blob.text() });
        }
      } catch {
        // Skip files that can't be read
      }
    }

    // 5. Detect injection patterns across ALL content
    const allContent = [
      skillMdContent,
      version.clawScanNote ?? "",
      ...fileContents.map((f) => f.content),
    ].join("\n");
    const injectionSignals = detectInjectionPatterns(allContent);

    // 6. Build eval context
    const parsed = version.parsed as SkillEvalContext["parsed"];
    const fm = parsed.frontmatter ?? {};
    const clawdisRecord = (parsed.clawdis ?? {}) as Record<string, unknown>;
    const clawdisLinks = (clawdisRecord.links ?? {}) as Record<string, unknown>;

    const evalCtx: SkillEvalContext = {
      slug: skill.slug,
      displayName: skill.displayName,
      ownerUserId: String(skill.ownerUserId),
      version: version.version,
      createdAt: version.createdAt,
      summary: (skill.summary as string | undefined) ?? undefined,
      source: (fm.source as string | undefined) ?? undefined,
      homepage:
        (fm.homepage as string | undefined) ??
        (clawdisRecord.homepage as string | undefined) ??
        (clawdisLinks.homepage as string | undefined) ??
        undefined,
      parsed,
      files: version.files.map((f) => ({ path: f.path, size: f.size })),
      skillMdContent,
      clawScanNote: version.clawScanNote,
      fileContents,
      injectionSignals,
      staticScan: version.staticScan,
      capabilityTags: version.capabilityTags,
    };

    // 6. Assemble user message
    const userMessage = assembleSkillEvalUserMessage(evalCtx);

    // 7. Call OpenAI Responses API (with retry for rate limits)
    const MAX_RETRIES = 3;
    let raw: string | null = null;
    try {
      const body = JSON.stringify({
        model,
        service_tier: serviceTier,
        instructions: SKILL_SECURITY_EVALUATOR_SYSTEM_PROMPT,
        input: userMessage,
        reasoning: {
          effort: reasoningEffort,
        },
        max_output_tokens: LLM_EVAL_MAX_OUTPUT_TOKENS,
        text: {
          format: {
            type: "json_object",
          },
        },
      });

      let response: Response | null = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body,
        });

        if (response.status === 429 || response.status >= 500) {
          if (attempt < MAX_RETRIES) {
            const delay = 2 ** attempt * 2000 + Math.random() * 1000;
            console.log(
              `[llmEval] Rate limited (${response.status}), retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
            );
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
        }
        break;
      }

      if (!response || !response.ok) {
        const errorText = response ? await response.text() : "No response";
        await storeError(`OpenAI API error (${response?.status}): ${errorText.slice(0, 200)}`);
        return;
      }

      const payload = (await response.json()) as unknown;
      raw = extractResponseText(payload);
    } catch (error) {
      await storeError(
        `OpenAI API call failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    if (!raw) {
      await storeError("Empty response from OpenAI");
      return;
    }

    // 8. Parse response
    const parsedResult = parseLlmEvalResponse(raw);

    if (!parsedResult) {
      console.error(`[llmEval] Raw response (first 500 chars): ${raw.slice(0, 500)}`);
      await storeError("Failed to parse LLM evaluation response");
      return;
    }

    const result = applyInjectionSignalFloor(parsedResult, injectionSignals);

    // 9. Store result
    await ctx.runMutation(internal.skills.updateVersionLlmAnalysisInternal, {
      versionId: args.versionId,
      ...(args.moderationMode ? { moderationMode: args.moderationMode } : {}),
      llmAnalysis: {
        status: verdictToStatus(result.verdict),
        verdict: result.verdict,
        confidence: result.confidence,
        summary: result.summary,
        dimensions: result.dimensions,
        guidance: result.guidance,
        findings: result.findings || undefined,
        agenticRiskFindings: result.agenticRiskFindings,
        riskSummary: result.riskSummary,
        model,
        checkedAt: Date.now(),
      },
    });

    console.log(
      `[llmEval] Evaluated ${skill.slug}@${version.version}: ${result.verdict} (${result.confidence} confidence)`,
    );

    // Normal writes recompute moderation in updateVersionLlmAnalysisInternal.
    // Preserve mode stores analysis only for one-time backfills.
  },
});

export const evaluatePackageReleaseWithLlm = internalAction({
  args: {
    releaseId: v.id("packageReleases"),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.log("[llmEval] OPENAI_API_KEY not configured, skipping package evaluation");
      return;
    }

    const model = getLlmEvalModel();
    const reasoningEffort = getLlmEvalReasoningEffort();
    const serviceTier = getLlmEvalServiceTier();
    const storeError = async (message: string) => {
      console.error(`[llmEval:package] ${message}`);
      await runMutationRef(ctx, internalRefs.packages.updateReleaseLlmAnalysisInternal, {
        releaseId: args.releaseId,
        llmAnalysis: {
          status: "error",
          summary: message,
          model,
          checkedAt: Date.now(),
        },
      });
    };

    const release = (await runQueryRef(ctx, internalRefs.packages.getReleaseByIdInternal, {
      releaseId: args.releaseId,
    })) as Doc<"packageReleases"> | null;
    if (!release || release.softDeletedAt) {
      await storeError(`Release ${args.releaseId} not found`);
      return;
    }

    const pkg = (await runQueryRef(ctx, internalRefs.packages.getPackageByIdInternal, {
      packageId: release.packageId,
    })) as Doc<"packages"> | null;
    if (!pkg) {
      await storeError(`Package ${release.packageId} not found`);
      return;
    }

    let readmeContent = "";
    const fileContents: Array<{ path: string; content: string }> = [];
    for (const f of release.files) {
      try {
        const blob = await ctx.storage.get(f.storageId as Id<"_storage">);
        if (!blob) continue;
        const content = await blob.text();
        fileContents.push({ path: f.path, content });
        const lower = f.path.toLowerCase();
        if (
          !readmeContent &&
          (lower === "readme.md" || lower === "readme.mdx" || lower === "readme.markdown")
        ) {
          readmeContent = content;
        }
      } catch {
        // Best-effort read.
      }
    }

    if (!readmeContent) {
      const packageJsonText = fileContents.find(
        (entry) => entry.path.toLowerCase() === "package.json",
      )?.content;
      readmeContent =
        packageJsonText ?? `# ${pkg.displayName}\n\n${release.summary ?? pkg.summary ?? pkg.name}`;
    }

    const allContent = [
      readmeContent,
      release.clawScanNote ?? "",
      ...fileContents.map((f) => f.content),
    ].join("\n");
    const injectionSignals = detectInjectionPatterns(allContent);
    const packageOpenClawMetadata = packageOpenClawEnvironmentForPrompt(
      release.extractedPackageJson,
    );

    const evalCtx: SkillEvalContext = {
      slug: pkg.name,
      displayName: pkg.displayName,
      ownerUserId: String(pkg.ownerUserId),
      version: release.version,
      createdAt: release.createdAt,
      summary: release.summary ?? pkg.summary ?? undefined,
      source: pkg.sourceRepo ?? undefined,
      homepage: undefined,
      parsed: {
        frontmatter: {},
        metadata: {
          ...(packageOpenClawMetadata ? { openclaw: packageOpenClawMetadata } : {}),
          compatibility: release.compatibility,
          capabilities: release.capabilities,
          verification: release.verification,
          staticScan: release.staticScan,
        },
      },
      files: release.files.map((f) => ({ path: f.path, size: f.size })),
      skillMdContent: readmeContent,
      clawScanNote: release.clawScanNote,
      fileContents,
      injectionSignals,
      staticScan: release.staticScan,
      capabilityTags: pkg.capabilityTags,
    };

    const userMessage = assembleEvalUserMessage(evalCtx);
    const MAX_RETRIES = 3;
    let raw: string | null = null;
    try {
      const body = JSON.stringify({
        model,
        service_tier: serviceTier,
        instructions: SKILL_SECURITY_EVALUATOR_SYSTEM_PROMPT,
        input: userMessage,
        reasoning: {
          effort: reasoningEffort,
        },
        max_output_tokens: LLM_EVAL_MAX_OUTPUT_TOKENS,
        text: {
          format: {
            type: "json_object",
          },
        },
      });

      let response: Response | null = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body,
        });

        if (response.status === 429 || response.status >= 500) {
          if (attempt < MAX_RETRIES) {
            const delay = 2 ** attempt * 2000 + Math.random() * 1000;
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
        }
        break;
      }

      if (!response || !response.ok) {
        const errorText = response ? await response.text() : "No response";
        await storeError(`OpenAI API error (${response?.status}): ${errorText.slice(0, 200)}`);
        return;
      }

      const payload = (await response.json()) as unknown;
      raw = extractResponseText(payload);
    } catch (error) {
      await storeError(
        `OpenAI API call failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    if (!raw) {
      await storeError("Empty response from OpenAI");
      return;
    }

    const parsedResult = parseLlmEvalResponse(raw);
    if (!parsedResult) {
      await storeError("Failed to parse LLM evaluation response");
      return;
    }
    const result = applyInjectionSignalFloor(parsedResult, injectionSignals);

    await runMutationRef(ctx, internalRefs.packages.updateReleaseLlmAnalysisInternal, {
      releaseId: args.releaseId,
      llmAnalysis: {
        status: verdictToStatus(result.verdict),
        verdict: result.verdict,
        confidence: result.confidence,
        summary: result.summary,
        dimensions: result.dimensions,
        guidance: result.guidance,
        findings: result.findings || undefined,
        agenticRiskFindings: result.agenticRiskFindings,
        riskSummary: result.riskSummary,
        model,
        checkedAt: Date.now(),
      },
    });
  },
});

// ---------------------------------------------------------------------------
// Convenience: evaluate a single skill by slug (for testing / manual runs)
// Usage: npx convex run llmEval:evaluateBySlug '{"slug": "transcribeexx"}'
// ---------------------------------------------------------------------------

export const evaluateBySlug = internalAction({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const skill = (await ctx.runQuery(internal.skills.getSkillBySlugInternal, {
      slug: args.slug,
    })) as Doc<"skills"> | null;

    if (!skill) {
      console.error(`[llmEval:bySlug] Skill "${args.slug}" not found`);
      return { error: "Skill not found" };
    }

    if (!skill.latestVersionId) {
      console.error(`[llmEval:bySlug] Skill "${args.slug}" has no published version`);
      return { error: "No published version" };
    }

    console.log(`[llmEval:bySlug] Evaluating ${args.slug} (versionId: ${skill.latestVersionId})`);

    await ctx.scheduler.runAfter(0, internal.llmEval.evaluateWithLlm, {
      versionId: skill.latestVersionId,
    });

    return { ok: true, slug: args.slug, versionId: skill.latestVersionId };
  },
});

// ---------------------------------------------------------------------------
// Backfill action (Phase 2)
// Schedules individual evaluateWithLlm actions for each skill in the batch,
// then self-schedules the next batch. Each eval runs as its own action
// invocation so we don't hit Convex action timeouts.
// ---------------------------------------------------------------------------

type LlmBackfillBatch = {
  skills: Array<{
    versionId: Id<"skillVersions">;
    slug: string;
  }>;
  nextCursor: number;
  done: boolean;
};

export const backfillLlmEval: ReturnType<typeof internalAction> = internalAction({
  args: {
    cursor: v.optional(v.number()),
    batchSize: v.optional(v.number()),
    delayMs: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    maxToSchedule: v.optional(v.number()),
    moderationMode: llmEvalModerationModeValidator,
    accTotal: v.optional(v.number()),
    accScheduled: v.optional(v.number()),
    accSkipped: v.optional(v.number()),
    startTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const startTime = args.startTime ?? Date.now();
    const apiKey = process.env.OPENAI_API_KEY;
    const dryRun = args.dryRun ?? false;
    if (!dryRun && !apiKey) {
      console.log("[llmEval:backfill] OPENAI_API_KEY not configured");
      return { error: "OPENAI_API_KEY not configured" };
    }

    const requestedBatchSize = Math.max(1, Math.min(Math.floor(args.batchSize ?? 25), 50));
    const maxToSchedule =
      args.maxToSchedule === undefined ? undefined : Math.max(0, Math.floor(args.maxToSchedule));
    const cursor = args.cursor ?? 0;
    const delayMs = Math.max(0, Math.floor(args.delayMs ?? 5_000));
    const moderationMode: LlmEvalModerationMode = args.moderationMode ?? "normal";
    let accTotal = args.accTotal ?? 0;
    let accScheduled = args.accScheduled ?? 0;
    let accSkipped = args.accSkipped ?? 0;
    const remaining =
      maxToSchedule === undefined ? undefined : Math.max(0, maxToSchedule - accScheduled);

    if (remaining === 0) {
      console.log("[llmEval:backfill] Schedule limit reached before fetching next batch");
      return {
        status: "limit_reached",
        total: accTotal,
        scheduled: accScheduled,
        skipped: accSkipped,
        cursor,
        moderationMode,
      };
    }

    const batchSize =
      remaining === undefined ? requestedBatchSize : Math.min(requestedBatchSize, remaining);

    const batch: LlmBackfillBatch = await ctx.runQuery(
      internal.skills.getActiveSkillBatchForLlmBackfillInternal,
      {
        cursor,
        batchSize,
      },
    );

    if (batch.skills.length === 0 && batch.done) {
      console.log("[llmEval:backfill] No more skills to evaluate");
      return { total: accTotal, scheduled: accScheduled, skipped: accSkipped, moderationMode };
    }

    console.log(
      `[llmEval:backfill] Processing batch of ${batch.skills.length} skills (cursor=${cursor}, accumulated=${accTotal}, moderationMode=${moderationMode}, dryRun=${dryRun})`,
    );

    for (const { versionId, slug } of batch.skills) {
      // Re-evaluate all (full file content reading upgrade)
      const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
        versionId,
      })) as Doc<"skillVersions"> | null;

      if (!version) {
        accSkipped++;
        continue;
      }

      // Schedule each evaluation as a separate action invocation.
      if (!dryRun) {
        await ctx.scheduler.runAfter(0, internal.llmEval.evaluateWithLlm, {
          versionId,
          moderationMode,
        });
      }
      accScheduled++;
      console.log(`[llmEval:backfill] ${dryRun ? "Would schedule" : "Scheduled"} eval for ${slug}`);
    }

    accTotal += batch.skills.length;
    const hitLimit = maxToSchedule !== undefined && accScheduled >= maxToSchedule;

    if (dryRun || hitLimit) {
      const durationMs = Date.now() - startTime;
      const result = {
        status: dryRun ? "dry_run" : "limit_reached",
        total: accTotal,
        scheduled: accScheduled,
        skipped: accSkipped,
        nextCursor: batch.nextCursor,
        done: batch.done,
        durationMs,
        moderationMode,
      };
      console.log("[llmEval:backfill] Paused:", result);
      return result;
    }

    if (!batch.done) {
      // Delay the next batch slightly to avoid overwhelming the scheduler
      // when all evals from this batch are also running
      console.log(
        `[llmEval:backfill] Scheduling next batch (cursor=${batch.nextCursor}, total so far=${accTotal})`,
      );
      await ctx.scheduler.runAfter(delayMs, internal.llmEval.backfillLlmEval, {
        cursor: batch.nextCursor,
        batchSize: requestedBatchSize,
        delayMs,
        ...(maxToSchedule !== undefined ? { maxToSchedule } : {}),
        moderationMode,
        accTotal,
        accScheduled,
        accSkipped,
        startTime,
      });
      return { status: "continuing", totalSoFar: accTotal };
    }

    const durationMs = Date.now() - startTime;
    const result = {
      total: accTotal,
      scheduled: accScheduled,
      skipped: accSkipped,
      durationMs,
      moderationMode,
    };
    console.log("[llmEval:backfill] Complete:", result);
    return result;
  },
});

const suspiciousSkillLlmRescanBucketValidator = v.union(
  v.literal("all"),
  v.literal("llm-only"),
  v.literal("vt-only"),
  v.literal("both"),
);

type SuspiciousSkillLlmRescanBucket = "all" | "llm-only" | "vt-only" | "both";

type SuspiciousSkillLlmRescanBatch = {
  skills: Array<{
    skillId: Id<"skills">;
    versionId: Id<"skillVersions">;
    slug: string;
    reasonCodes: string[];
  }>;
  examined: number;
  continueCursor: string | null;
  isDone: boolean;
};

type SuspiciousSkillCountPage = {
  examined: number;
  suspicious: number;
  malicious: number;
  blocked: number;
  noLatestVersion: number;
  rescanable: number;
  llmOnly: number;
  vtOnly: number;
  both: number;
  noScannerReason: number;
  continueCursor: string | null;
  isDone: boolean;
};

export const scheduleSuspiciousSkillLlmRescanInternal: ReturnType<typeof internalAction> =
  internalAction({
    args: {
      bucket: suspiciousSkillLlmRescanBucketValidator,
      cursor: v.optional(v.union(v.string(), v.null())),
      batchSize: v.optional(v.number()),
      pageDelayMs: v.optional(v.number()),
      evalDelayStepMs: v.optional(v.number()),
      dryRun: v.optional(v.boolean()),
      maxToSchedule: v.optional(v.number()),
      moderationMode: llmEvalModerationModeValidator,
      accExamined: v.optional(v.number()),
      accScheduled: v.optional(v.number()),
      accSkipped: v.optional(v.number()),
      startTime: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
      const dryRun = args.dryRun ?? false;
      if (!dryRun && !process.env.OPENAI_API_KEY) {
        return { error: "OPENAI_API_KEY not configured" };
      }

      const batchSize = Math.max(1, Math.min(Math.floor(args.batchSize ?? 100), 200));
      const pageDelayMs = Math.max(0, Math.floor(args.pageDelayMs ?? 1_000));
      const evalDelayStepMs = Math.max(0, Math.floor(args.evalDelayStepMs ?? 250));
      const moderationMode: LlmEvalModerationMode = args.moderationMode ?? "normal";
      const bucket: SuspiciousSkillLlmRescanBucket = args.bucket;
      const startTime = args.startTime ?? Date.now();
      const maxToSchedule =
        args.maxToSchedule === undefined ? undefined : Math.max(0, Math.floor(args.maxToSchedule));
      let accExamined = args.accExamined ?? 0;
      let accScheduled = args.accScheduled ?? 0;
      let accSkipped = args.accSkipped ?? 0;

      const remaining =
        maxToSchedule === undefined ? undefined : Math.max(0, maxToSchedule - accScheduled);
      if (remaining === 0) {
        return {
          status: "limit_reached",
          bucket,
          examined: accExamined,
          scheduled: accScheduled,
          skipped: accSkipped,
          cursor: args.cursor ?? null,
        };
      }

      const batch: SuspiciousSkillLlmRescanBatch = await runQueryRef(
        ctx,
        internalRefs.skills.getSuspiciousSkillBatchForLlmRescanInternal,
        {
          bucket,
          cursor: args.cursor ?? null,
          batchSize,
        },
      );

      accExamined += batch.examined;
      const scheduleLimit = remaining ?? Number.POSITIVE_INFINITY;
      let scheduledThisPage = 0;
      for (const skill of batch.skills) {
        if (scheduledThisPage >= scheduleLimit) {
          accSkipped += batch.skills.length - scheduledThisPage;
          break;
        }

        if (!dryRun) {
          await runAfterRef(
            ctx,
            (accScheduled + scheduledThisPage) * evalDelayStepMs,
            internalRefs.llmEval.evaluateWithLlm,
            {
              versionId: skill.versionId,
              moderationMode,
            },
          );
        }
        scheduledThisPage++;
      }
      accScheduled += scheduledThisPage;

      const hitLimit = maxToSchedule !== undefined && accScheduled >= maxToSchedule;
      if (!batch.isDone && !dryRun && !hitLimit) {
        await runAfterRef(
          ctx,
          pageDelayMs,
          internalRefs.llmEval.scheduleSuspiciousSkillLlmRescanInternal,
          {
            bucket,
            cursor: batch.continueCursor,
            batchSize,
            pageDelayMs,
            evalDelayStepMs,
            moderationMode,
            ...(maxToSchedule !== undefined ? { maxToSchedule } : {}),
            accExamined,
            accScheduled,
            accSkipped,
            startTime,
          },
        );
      }

      if (dryRun || hitLimit || batch.isDone) {
        return {
          status: dryRun ? "dry_run" : hitLimit ? "limit_reached" : "complete",
          bucket,
          examined: accExamined,
          scheduled: accScheduled,
          skipped: accSkipped,
          cursor: batch.continueCursor,
          done: batch.isDone,
          durationMs: Date.now() - startTime,
        };
      }

      return {
        status: "continuing",
        bucket,
        examined: accExamined,
        scheduled: accScheduled,
        skipped: accSkipped,
        cursor: batch.continueCursor,
      };
    },
  });

type SuspiciousPluginLlmRescanBatch = {
  releases: Array<{
    packageId: Id<"packages">;
    releaseId: Id<"packageReleases">;
    name: string;
    family: string;
  }>;
  examined: number;
  continueCursor: string | null;
  isDone: boolean;
};

type PluginScanStatusCountPage = {
  examined: number;
  activePlugins: number;
  clean: number;
  pending: number;
  notRun: number;
  suspicious: number;
  malicious: number;
  unknown: number;
  latestSuspicious: number;
  latestMalicious: number;
  latestBlocked: number;
  continueCursor: string | null;
  isDone: boolean;
};

export const scheduleSuspiciousPluginLlmRescanInternal: ReturnType<typeof internalAction> =
  internalAction({
    args: {
      cursor: v.optional(v.union(v.string(), v.null())),
      batchSize: v.optional(v.number()),
      pageDelayMs: v.optional(v.number()),
      evalDelayStepMs: v.optional(v.number()),
      dryRun: v.optional(v.boolean()),
      maxToSchedule: v.optional(v.number()),
      accExamined: v.optional(v.number()),
      accScheduled: v.optional(v.number()),
      accSkipped: v.optional(v.number()),
      startTime: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
      const dryRun = args.dryRun ?? false;
      if (!dryRun && !process.env.OPENAI_API_KEY) {
        return { error: "OPENAI_API_KEY not configured" };
      }

      const batchSize = Math.max(1, Math.min(Math.floor(args.batchSize ?? 100), 200));
      const pageDelayMs = Math.max(0, Math.floor(args.pageDelayMs ?? 1_000));
      const evalDelayStepMs = Math.max(0, Math.floor(args.evalDelayStepMs ?? 250));
      const startTime = args.startTime ?? Date.now();
      const maxToSchedule =
        args.maxToSchedule === undefined ? undefined : Math.max(0, Math.floor(args.maxToSchedule));
      let accExamined = args.accExamined ?? 0;
      let accScheduled = args.accScheduled ?? 0;
      let accSkipped = args.accSkipped ?? 0;

      const remaining =
        maxToSchedule === undefined ? undefined : Math.max(0, maxToSchedule - accScheduled);
      if (remaining === 0) {
        return {
          status: "limit_reached",
          examined: accExamined,
          scheduled: accScheduled,
          skipped: accSkipped,
          cursor: args.cursor ?? null,
        };
      }

      const batch: SuspiciousPluginLlmRescanBatch = await runQueryRef(
        ctx,
        internalRefs.packages.getSuspiciousPluginReleaseBatchForLlmRescanInternal,
        {
          cursor: args.cursor ?? null,
          batchSize,
        },
      );

      accExamined += batch.examined;
      const scheduleLimit = remaining ?? Number.POSITIVE_INFINITY;
      let scheduledThisPage = 0;
      for (const release of batch.releases) {
        if (scheduledThisPage >= scheduleLimit) {
          accSkipped += batch.releases.length - scheduledThisPage;
          break;
        }

        if (!dryRun) {
          await runAfterRef(
            ctx,
            (accScheduled + scheduledThisPage) * evalDelayStepMs,
            internalRefs.llmEval.evaluatePackageReleaseWithLlm,
            {
              releaseId: release.releaseId,
            },
          );
        }
        scheduledThisPage++;
      }
      accScheduled += scheduledThisPage;

      const hitLimit = maxToSchedule !== undefined && accScheduled >= maxToSchedule;
      if (!batch.isDone && !dryRun && !hitLimit) {
        await runAfterRef(
          ctx,
          pageDelayMs,
          internalRefs.llmEval.scheduleSuspiciousPluginLlmRescanInternal,
          {
            cursor: batch.continueCursor,
            batchSize,
            pageDelayMs,
            evalDelayStepMs,
            ...(maxToSchedule !== undefined ? { maxToSchedule } : {}),
            accExamined,
            accScheduled,
            accSkipped,
            startTime,
          },
        );
      }

      if (dryRun || hitLimit || batch.isDone) {
        return {
          status: dryRun ? "dry_run" : hitLimit ? "limit_reached" : "complete",
          examined: accExamined,
          scheduled: accScheduled,
          skipped: accSkipped,
          cursor: batch.continueCursor,
          done: batch.isDone,
          durationMs: Date.now() - startTime,
        };
      }

      return {
        status: "continuing",
        examined: accExamined,
        scheduled: accScheduled,
        skipped: accSkipped,
        cursor: batch.continueCursor,
      };
    },
  });

export const countSuspiciousInventoryInternal: ReturnType<typeof internalAction> = internalAction({
  args: {
    batchSize: v.optional(v.number()),
    maxPages: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = Math.max(1, Math.min(Math.floor(args.batchSize ?? 200), 200));
    const maxPages = Math.max(1, Math.min(Math.floor(args.maxPages ?? 500), 1_000));
    const startedAt = Date.now();

    let skillCursor: string | null = null;
    let skillPages = 0;
    let skillComplete = false;
    const skills = {
      examined: 0,
      suspicious: 0,
      malicious: 0,
      blocked: 0,
      noLatestVersion: 0,
      rescanable: 0,
      llmOnly: 0,
      vtOnly: 0,
      both: 0,
      noScannerReason: 0,
    };

    while (skillPages < maxPages) {
      const page: SuspiciousSkillCountPage = await runQueryRef(
        ctx,
        internalRefs.skills.getSuspiciousSkillCountPageInternal,
        { cursor: skillCursor, batchSize },
      );
      skills.examined += page.examined;
      skills.suspicious += page.suspicious;
      skills.malicious += page.malicious;
      skills.blocked += page.blocked;
      skills.noLatestVersion += page.noLatestVersion;
      skills.rescanable += page.rescanable;
      skills.llmOnly += page.llmOnly;
      skills.vtOnly += page.vtOnly;
      skills.both += page.both;
      skills.noScannerReason += page.noScannerReason;
      skillPages++;
      skillCursor = page.continueCursor;
      if (page.isDone || !skillCursor) {
        skillComplete = true;
        break;
      }
    }

    let pluginCursor: string | null = null;
    let pluginPages = 0;
    let pluginComplete = false;
    const plugins = {
      examined: 0,
      activePlugins: 0,
      clean: 0,
      pending: 0,
      notRun: 0,
      suspicious: 0,
      malicious: 0,
      unknown: 0,
      latestSuspicious: 0,
      latestMalicious: 0,
      latestBlocked: 0,
    };

    while (pluginPages < maxPages) {
      const page: PluginScanStatusCountPage = await runQueryRef(
        ctx,
        internalRefs.packages.getPluginScanStatusCountPageInternal,
        { cursor: pluginCursor, batchSize },
      );
      plugins.examined += page.examined;
      plugins.activePlugins += page.activePlugins;
      plugins.clean += page.clean;
      plugins.pending += page.pending;
      plugins.notRun += page.notRun;
      plugins.suspicious += page.suspicious;
      plugins.malicious += page.malicious;
      plugins.unknown += page.unknown;
      plugins.latestSuspicious += page.latestSuspicious;
      plugins.latestMalicious += page.latestMalicious;
      plugins.latestBlocked += page.latestBlocked;
      pluginPages++;
      pluginCursor = page.continueCursor;
      if (page.isDone || !pluginCursor) {
        pluginComplete = true;
        break;
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      complete: skillComplete && pluginComplete,
      durationMs: Date.now() - startedAt,
      batchSize,
      maxPages,
      skills: {
        ...skills,
        pages: skillPages,
        complete: skillComplete,
        cursor: skillCursor,
      },
      plugins: {
        ...plugins,
        pages: pluginPages,
        complete: pluginComplete,
        cursor: pluginCursor,
      },
    };
  },
});

export const evaluateCommentForScam = internalAction({
  args: {
    commentId: v.id("comments"),
    skillId: v.id("skills"),
    userId: v.id("users"),
    body: v.string(),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "OPENAI_API_KEY not configured" };
    }

    const model = getCommentScamEvalModel();
    const input = assembleCommentScamEvalUserMessage({
      commentId: String(args.commentId),
      skillId: String(args.skillId),
      userId: String(args.userId),
      body: args.body,
    });

    const requestBody = JSON.stringify({
      model,
      instructions: COMMENT_SCAM_EVALUATOR_SYSTEM_PROMPT,
      input,
      max_output_tokens: COMMENT_SCAM_EVAL_MAX_OUTPUT_TOKENS,
      text: {
        format: {
          type: "json_object",
        },
      },
    });

    const MAX_RETRIES = 3;
    let response: Response | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: requestBody,
      });

      if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
        const delay = 2 ** attempt * 2000 + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      break;
    }

    if (!response || !response.ok) {
      const errorText = response ? await response.text() : "No response";
      return {
        ok: false as const,
        error: `OpenAI API error (${response?.status}): ${errorText.slice(0, 200)}`,
      };
    }

    const payload = (await response.json()) as unknown;
    const raw = extractResponseText(payload);
    if (!raw) {
      return { ok: false as const, error: "Empty response from OpenAI" };
    }

    const parsed = parseCommentScamEvalResponse(raw);
    if (!parsed) {
      console.error(`[commentScam] Parse failure for ${args.commentId}: ${raw.slice(0, 400)}`);
      return { ok: false as const, error: "Failed to parse scam evaluation response" };
    }

    return {
      ok: true as const,
      model,
      verdict: parsed.verdict,
      confidence: parsed.confidence,
      explanation: parsed.explanation,
      evidence: parsed.evidence,
    };
  },
});
