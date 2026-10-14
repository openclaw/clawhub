import { internalMutation } from "./functions";
import { assertLocalDevSeedAllowed } from "./lib/devSeed";
import { extractPackageDigestFields, upsertPackageSearchDigest } from "./lib/packageSearchDigest";

// Deterministic local catalog, deliberately separate from the public catalog.
// These entries exercise discovery and read-only details, not installation.
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertLocalDevSeedAllowed("Claw discovery");
    const now = Date.now();
    let owner = await ctx.db
      .query("users")
      .withIndex("handle", (q) => q.eq("handle", "field-guide-dev"))
      .first();
    if (!owner) {
      const id = await ctx.db.insert("users", {
        name: "Field Guide Dev",
        handle: "field-guide-dev",
        role: "user",
        createdAt: now,
        updatedAt: now,
      });
      owner = await ctx.db.get(id);
    }
    if (!owner) throw new Error("Missing fixture owner");
    const groups = [
      {
        category: "research",
        names: ["Sift", "Sourcebook", "Observatory", "Footnote"],
        summaries: [
          "Turn a pile of sources into a clear, cited briefing.",
          "Keep the evidence behind every decision close at hand.",
          "Follow an industry and surface the developments that matter.",
          "Check claims, trace sources, and find the missing context.",
        ],
      },
      {
        category: "coding",
        names: ["Patch", "Code Cartographer", "Test Pilot", "Release Notes"],
        summaries: [
          "A thoughtful second pair of eyes for your next pull request.",
          "Find your way through an unfamiliar codebase.",
          "Turn tricky edge cases into a focused test plan.",
          "Tell the story of what changed and why it matters.",
        ],
      },
      {
        category: "productivity",
        names: ["Daybreak", "Loose Ends", "Minutes", "Relay"],
        summaries: [
          "Start the day with a short briefing and a practical plan.",
          "Collect open loops and decide what needs your attention.",
          "Turn meeting notes into decisions, owners, and next steps.",
          "Keep the context intact when work changes hands.",
        ],
      },
      {
        category: "writing",
        names: ["Marginalia", "First Draft", "Plainspoken", "Copy Desk"],
        summaries: [
          "An attentive editor for ideas that deserve a clearer voice.",
          "Find the structure hiding inside your rough notes.",
          "Make complex subjects easier to understand.",
          "Catch inconsistencies before your writing goes out.",
        ],
      },
      {
        category: "data-analysis",
        names: ["Signal", "Table Talk", "Trendline", "Data Detective"],
        summaries: [
          "Explore a dataset and explain what the numbers say.",
          "Ask better questions of your spreadsheets.",
          "Track meaningful changes without losing the longer view.",
          "Investigate missing values and surprising results.",
        ],
      },
      {
        category: "design",
        names: ["Studio", "Contrast", "Canvas", "Wayfinder"],
        summaries: [
          "Explore a design direction with a careful creative partner.",
          "Review an interface for clarity and accessibility.",
          "Turn a loose brief into a useful creative starting point.",
          "Map the journey and find where people get stuck.",
        ],
      },
    ];
    for (const [groupIndex, group] of groups.entries()) {
      for (const [index, displayName] of group.names.entries()) {
        const name = `@field-guide-dev/${displayName.toLowerCase().replaceAll(" ", "-")}`;
        if (
          await ctx.db
            .query("packages")
            .withIndex("by_name", (q) => q.eq("normalizedName", name))
            .first()
        )
          continue;
        const packageId = await ctx.db.insert("packages", {
          name,
          normalizedName: name,
          displayName,
          summary: group.summaries[index],
          ownerUserId: owner._id,
          family: "claw",
          channel: "community",
          isOfficial: false,
          tags: {},
          categories: [group.category],
          scanStatus: "clean",
          stats: {
            downloads: (6 - groupIndex) * 1000 - index * 170,
            installs: (6 - groupIndex) * 100 - index * 10,
            stars: 20 - index,
            versions: 1,
          },
          createdAt: now,
          updatedAt: now,
        });
        const releaseId = await ctx.db.insert("packageReleases", {
          packageId,
          version: "1.0.0",
          changelog: "Local discovery fixture.",
          createdBy: owner._id,
          createdAt: now,
          distTags: ["latest"],
          files: [],
          integritySha256: "0".repeat(64),
          clawManifestSummary: {
            schemaVersion: 1,
            agent: {
              id: name.split("/")[1],
              name: displayName,
              description: group.summaries[index],
            },
            workspace: { bootstrapFiles: ["SOUL.md", "AGENTS.md"], fileCount: 2 },
            packages: { skillCount: 2, pluginCount: 1 },
            mcpServerCount: 0,
            cronJobCount: 0,
          },
        });
        await ctx.db.patch(packageId, {
          latestReleaseId: releaseId,
          latestVersionSummary: {
            version: "1.0.0",
            createdAt: now,
            changelog: "Local discovery fixture.",
          },
        });
        const pkg = await ctx.db.get(packageId);
        if (pkg)
          await upsertPackageSearchDigest(ctx, {
            ...extractPackageDigestFields(pkg),
            ownerHandle: owner.handle,
            ownerKind: "user",
          });
        if (index === 0 && groupIndex < 4)
          await ctx.db.insert("packageBadges", {
            packageId,
            kind: "highlighted",
            byUserId: owner._id,
            at: now - groupIndex,
          });
      }
    }
    return { claws: 24, owner: owner.handle };
  },
});
