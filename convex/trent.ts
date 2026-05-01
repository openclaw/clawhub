import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./functions";
import { buildDeterministicZip } from "./lib/skillZip";
import { parseTrentSkillVerdictPayload } from "./lib/trent";

const TRENT_SKILL_VERDICT_BASE_URL = "https://api.trent.ai/v1/humber-agent/openclaw/skills/verdict";
const SHA256_HASH_PATTERN = /^[a-f0-9]{64}$/i;
const TRENT_REQUEST_TIMEOUT_MS = 5_000;
const TRENT_REFRESH_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TRENT_RESCHEDULE_DELAY_MS = 250;

export const scanSkillVersionWithTrentClaw = internalAction({
  args: {
    versionId: v.id("skillVersions"),
  },
  handler: async (ctx, args) => {
    const version = await ctx.runQuery(internal.skills.getVersionByIdInternal, {
      versionId: args.versionId,
    });
    if (!version) {
      console.error(`[trent] Version ${args.versionId} not found for scanning`);
      return;
    }

    const skillSha256 = await getOrComputeSkillSha256(ctx, version);
    if (!skillSha256) {
      console.warn(`[trent] Could not compute hash for version ${args.versionId}`);
      return;
    }

    try {
      const response = await fetchTrentVerdict(skillSha256);
      if (!response.ok) {
        console.error(`[trent] Verdict request failed for ${skillSha256}: ${response.status}`);
        return;
      }

      const payload = parseTrentSkillVerdictPayload(await response.json(), skillSha256);
      await ctx.runMutation(internal.skills.updateVersionScanResultsInternal, {
        versionId: args.versionId,
        trentAnalysis: {
          skillSha256: payload.skill_sha256,
          verdict: payload.verdict,
          checkedAt: Date.now(),
        },
      });
    } catch (error) {
      console.error(`[trent] Verdict request errored for ${skillSha256}:`, error);
    }
  },
});

export const refreshStaleTrentClawVerdicts = internalAction({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ scheduled: number }> => {
    const limit = Math.min(Math.max(args.batchSize ?? 50, 1), 200);
    const candidates = (await ctx.runQuery(internal.skills.getTrentRescanCandidatesInternal, {
      limit,
      staleBefore: Date.now() - TRENT_REFRESH_AGE_MS,
    })) as Array<Id<"skillVersions">>;

    let delayMs = 0;
    for (const versionId of candidates) {
      await ctx.scheduler.runAfter(delayMs, internal.trent.scanSkillVersionWithTrentClaw, {
        versionId,
      });
      delayMs += TRENT_RESCHEDULE_DELAY_MS;
    }

    return { scheduled: candidates.length };
  },
});

async function fetchTrentVerdict(skillSha256: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRENT_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${TRENT_SKILL_VERDICT_BASE_URL}/${encodeURIComponent(skillSha256)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getOrComputeSkillSha256(
  ctx: ActionCtx,
  version: Doc<"skillVersions">,
): Promise<string | null> {
  if (version.sha256hash && SHA256_HASH_PATTERN.test(version.sha256hash)) {
    return version.sha256hash.toLowerCase();
  }

  const skill = await ctx.runQuery(internal.skills.getSkillByIdInternal, {
    skillId: version.skillId,
  });
  if (!skill) return null;

  const entries: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const file of version.files) {
    const content = await ctx.storage.get(file.storageId);
    if (!content) continue;
    entries.push({ path: file.path, bytes: new Uint8Array(await content.arrayBuffer()) });
  }
  if (entries.length === 0) return null;

  const zipArray = buildDeterministicZip(entries, {
    ownerId: String(skill.ownerUserId),
    slug: skill.slug,
    version: version.version,
    publishedAt: version.createdAt,
  });
  const hashBuffer = await crypto.subtle.digest("SHA-256", zipArray);
  const skillSha256 = Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  await ctx.runMutation(internal.skills.updateVersionScanResultsInternal, {
    versionId: version._id,
    sha256hash: skillSha256,
  });
  return skillSha256;
}
