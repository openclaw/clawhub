/** Reusable, explicitly simulated browser fixtures. Never usable against cloud deployments. */
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction, internalMutation } from "./functions";
import { isLocalDevAuthEnabled } from "./lib/devAuth";
import { hashSkillFiles } from "./lib/skills/fileHash";

const name = "openclaw-music-manager";
const manifest = {
  schemaVersion: 1,
  agent: {
    id: "music-manager",
    name: "Music Manager",
    description:
      "Organize a personal music library, curate playlists, and prepare weekly listening recommendations.",
  },
  skills: [{ path: "skills/library" }],
  plugins: [{ path: "plugins/player" }],
  workspace: { bootstrapFiles: { "AGENTS.md": { source: "workspace/AGENTS.md" } } },
  automations: [
    {
      id: "weekly-discovery",
      name: "Weekly listening discoveries",
      enabled: false,
      schedule: { cron: "0 18 * * 5", timezone: "UTC" },
      session: "isolated",
      message: "Prepare five listening recommendations from the approved library.",
      delivery: { mode: "none" },
    },
  ],
};
const contents =
  "---\n" +
  JSON.stringify(manifest) +
  "\n---\n# Your music, thoughtfully organized\n\nKeep playlists coherent, discover overlooked favorites, and make room for something new.\n\n## Library workflow\n\n- Work only within the music folder the user approves.\n- Ask before moving or deleting tracks.\n- Preview playlist edits before saving them.\n\n## Weekly discoveries\n\nSuggest five tracks and explain what connects them. The included automation starts paused.\n";
export const seed = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!isLocalDevAuthEnabled()) throw new Error("Local Template audit fixture only");
    const files = [];
    for (const [path, content] of Object.entries({
      "CLAW.md": contents,
      "package.json": JSON.stringify({ name, version: "1.2.0", openclaw: { template: "CLAW.md" } }),
      "workspace/AGENTS.md": "# Music Manager\nAsk before accessing private library folders.\n",
      "skills/library/SKILL.md": "# Library\nRead only the user-approved music directory.\n",
      "plugins/player/package.json": JSON.stringify({ name: "local-player", version: "1.0.0" }),
    })) {
      const bytes = new TextEncoder().encode(content);
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      files.push({
        path,
        size: bytes.length,
        sha256,
        storageId: await ctx.storage.store(new Blob([content], { type: "text/plain" })),
        contentType: "text/plain",
      });
    }
    return ctx.runMutation(makeFunctionReference<"mutation">("devTemplateAuditFixtures:insert"), {
      files,
    });
  },
});
export const insert = internalMutation({
  args: {
    files: v.array(
      v.object({
        path: v.string(),
        size: v.number(),
        sha256: v.string(),
        storageId: v.id("_storage"),
        contentType: v.string(),
      }),
    ),
  },
  handler: async (ctx, { files }) => {
    if (!isLocalDevAuthEnabled()) throw new Error("Local Template audit fixture only");
    const now = 1794513600000;
    const existing = await ctx.db
      .query("packages")
      .withIndex("by_name", (q) => q.eq("normalizedName", name))
      .unique();
    if (existing) {
      for (const file of files) await ctx.storage.delete(file.storageId);
      return { name, simulated: true, existing: true };
    }
    const userId = await ctx.db.insert("users", {
      handle: "ameliomansour",
      name: "Amelio Mansour (local fixture)",
      createdAt: now,
      updatedAt: now,
    });
    const verification = {
      tier: "structural" as const,
      scope: "artifact-only" as const,
      scanStatus: "clean" as const,
    };
    const packageId = await ctx.db.insert("packages", {
      name,
      normalizedName: name,
      displayName: "Music Manager",
      summary: manifest.agent.description,
      ownerUserId: userId,
      family: "claw",
      channel: "community",
      isOfficial: false,
      tags: {},
      verification,
      scanStatus: "clean",
      stats: { downloads: 128, installs: 34, stars: 7, versions: 2 },
      createdAt: now,
      updatedAt: now,
    });
    let latestReleaseId;
    for (const [version, findings] of [
      ["1.1.0", true],
      ["1.2.0", false],
    ] as const) {
      const releaseId = await ctx.db.insert("packageReleases", {
        packageId,
        version,
        publicationStatus: "published",
        changelog: "Simulated local UI fixture; not a live scanner run.",
        distTags: findings ? [] : ["latest"],
        files,
        integritySha256: await hashSkillFiles(files),
        extractedPackageJson: { name, version, openclaw: { template: "CLAW.md" } },
        templateInventory: [
          { kind: "skill", source: "bundled", path: "skills/library", name: "Library organizer" },
          { kind: "plugin", source: "bundled", path: "plugins/player", name: "Local player" },
        ],
        verification,
        aigAnalysis: {
          status: findings ? "suspicious" : "clean",
          scannerVersion: "0.2.0",
          issueCount: findings ? 2 : 0,
          findings: findings
            ? [
                {
                  ruleId: "MCP-004",
                  level: "warning",
                  title: "Library access boundary needs review",
                  message: "Evidence: Read only the user-approved music directory.",
                  description:
                    "Confirm the selected library directory before granting filesystem access.",
                  file: "skills/library/SKILL.md",
                  startLine: 1,
                  endLine: 2,
                  remediation: "Limit access to the chosen music folder.",
                },
                {
                  ruleId: "supplemental.dynamic.workspace-boundary",
                  level: "note",
                  message:
                    "The bundled workspace instructions require confirmation before private folder access.",
                  file: "workspace/AGENTS.md",
                  startLine: 2,
                },
              ]
            : [],
          summary: findings
            ? "Simulated A.I.G MCP fixture: two findings retained for review."
            : "Simulated A.I.G MCP fixture: no findings reported.",
          checkedAt: now,
        },
        llmAnalysis: {
          status: "completed",
          verdict: findings ? "suspicious" : "benign",
          confidence: "high",
          summary: findings
            ? "Review the library access boundary before granting permissions."
            : "The stored fixture evidence is consistent with the declared library workflow.",
          model: "simulated-local-evidence-judge-not-live",
          checkedAt: now,
        },
        createdBy: userId,
        publishActor: { kind: "user", userId },
        createdAt: now,
      });
      if (!findings) latestReleaseId = releaseId;
    }
    if (latestReleaseId)
      await ctx.db.patch(packageId, {
        latestReleaseId,
        tags: { latest: latestReleaseId },
        latestVersionSummary: {
          version: "1.2.0",
          createdAt: now,
          changelog: "Simulated local browser fixture",
          verification,
        },
      });
    return { name, packageId, simulated: true };
  },
});
