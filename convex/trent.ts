import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./functions";
import { parseTrentSkillVerdictPayload } from "./lib/trent";
import { buildDeterministicZip } from "./lib/skillZip";

const TRENT_SKILL_VERDICT_BASE_URL =
  "https://api.trent.ai/v1/humber-agent/openclaw/skills/verdict";
const SHA256_HASH_PATTERN = /^[a-f0-9]{64}$/i;

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
      const response = await fetch(
        `${TRENT_SKILL_VERDICT_BASE_URL}/${encodeURIComponent(skillSha256)}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
        },
      );
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
