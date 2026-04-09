import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { internalAction, internalMutation } from "./functions";
import { EMBEDDING_DIMENSIONS } from "./lib/embeddings";
import { parseClawdisMetadata, parseFrontmatter } from "./lib/skills";

type SeedSkillSpec = {
  slug: string;
  displayName: string;
  summary: string;
  version: string;
  metadata: Record<string, unknown>;
  rawSkillMd: string;
};

type SeedActionArgs = {
  reset?: boolean;
};

type SeedActionResult = {
  ok: true;
  results: Array<Record<string, unknown> & { slug: string }>;
};

type SeedMutationResult = Record<string, unknown>;

const SEED_SKILLS: SeedSkillSpec[] = [
  {
    slug: "padel",
    displayName: "Padel",
    summary: "Check padel court availability and manage bookings via Playtomic.",
    version: "0.1.0",
    metadata: {
      clawdbot: {
        nix: {
          plugin: "github:joshp123/padel-cli",
          systems: ["aarch64-darwin", "x86_64-linux"],
        },
        config: {
          requiredEnv: ["PADEL_AUTH_FILE"],
          stateDirs: [".config/padel"],
          example:
            'config = { env = { PADEL_AUTH_FILE = "/run/agenix/padel-auth"; }; stateDirs = [ ".config/padel" ]; };',
        },
        cliHelp: `Padel CLI for availability

Usage:
  padel [command]

Available Commands:
  auth         Manage authentication
  availability Show availability for a club on a date
  book         Book a court
  bookings     Manage bookings history
  search       Search for available courts
  venues       Manage saved venues

Flags:
  -h, --help   help for padel
  --json       Output JSON

Use "padel [command] --help" for more information about a command.
`,
      },
    },
    rawSkillMd: `---
name: padel
description: Check padel court availability and manage bookings via the padel CLI.
---

# Padel Booking Skill

## CLI

\`\`\`bash
padel  # On PATH (clawdbot plugin bundle)
\`\`\`

## Venues

Use the configured venue list in order of preference. If no venues are configured, ask for a venue name or location.

## Commands

### Check next booking
\`\`\`bash
padel bookings list 2>&1 | head -3
\`\`\`

### Search availability
\`\`\`bash
padel search --venues VENUE1,VENUE2 --date YYYY-MM-DD --time 09:00-12:00
\`\`\`

## Response guidelines

- Keep responses concise.
- Use 🎾 emoji.
- End with a call to action.

## Authorization

Only the authorized booker can confirm bookings. If the requester is not authorized, ask the authorized user to confirm.
`,
  },
  {
    slug: "gohome",
    displayName: "GoHome",
    summary: "Operate GoHome via gRPC discovery, metrics, and Grafana dashboards.",
    version: "0.1.0",
    metadata: {
      clawdbot: {
        nix: {
          plugin: "github:joshp123/gohome",
          systems: ["x86_64-linux", "aarch64-linux"],
        },
        config: {
          requiredEnv: ["GOHOME_GRPC_ADDR", "GOHOME_HTTP_BASE"],
          example:
            'config = { env = { GOHOME_GRPC_ADDR = "gohome:9000"; GOHOME_HTTP_BASE = "http://gohome:8080"; }; };',
        },
        cliHelp: `GoHome CLI

Usage:
  gohome-cli [command]

Available Commands:
  services   List registered services
  plugins    Inspect loaded plugins
  methods    List RPC methods
  call       Call an RPC method
  roborock   Manage roborock devices
  tado       Manage tado zones

Flags:
  --grpc-addr string   gRPC endpoint (host:port)
  -h, --help           help for gohome-cli
`,
      },
    },
    rawSkillMd: `---
name: gohome
description: Use when Clawdbot needs to test or operate GoHome via gRPC discovery, metrics, and Grafana.
---

# GoHome Skill

## Quick start

\`\`\`bash
export GOHOME_HTTP_BASE="http://gohome:8080"
export GOHOME_GRPC_ADDR="gohome:9000"
\`\`\`

## CLI

\`\`\`bash
gohome-cli services
\`\`\`

## Discovery flow (read-only)

1) List plugins.
2) Describe a plugin.
3) List RPC methods.
4) Call a read-only RPC.

## Metrics validation

\`\`\`bash
curl -s "\${GOHOME_HTTP_BASE}/gohome/metrics" | rg -n "gohome_"
\`\`\`

## Stateful actions

Only call write RPCs after explicit user approval.
`,
  },
  {
    slug: "xuezh",
    displayName: "Xuezh",
    summary: "Teach Mandarin with the xuezh engine for review, speaking, and audits.",
    version: "0.1.0",
    metadata: {
      clawdbot: {
        nix: {
          plugin: "github:joshp123/xuezh",
          systems: ["aarch64-darwin", "x86_64-linux"],
        },
        config: {
          requiredEnv: ["XUEZH_AZURE_SPEECH_KEY_FILE", "XUEZH_AZURE_SPEECH_REGION"],
          stateDirs: [".config/xuezh"],
          example:
            'config = { env = { XUEZH_AZURE_SPEECH_KEY_FILE = "/run/agenix/xuezh-azure-speech-key"; XUEZH_AZURE_SPEECH_REGION = "westeurope"; }; stateDirs = [ ".config/xuezh" ]; };',
        },
        cliHelp: `xuezh - Chinese learning engine

Usage:
  xuezh [command]

Available Commands:
  snapshot  Fetch learner state snapshot
  review    Review due items
  audio     Process speech audio
  items     Manage learning items
  events    Log learning events

Flags:
  -h, --help   help for xuezh
  --json       Output JSON
`,
      },
    },
    rawSkillMd: `---
name: xuezh
description: Teach Mandarin using the xuezh engine for review, speaking, and audits.
---

# Xuezh Skill

## Contract

Use the xuezh CLI exactly as specified. If a command is missing, ask for implementation instead of guessing.

## Default loop

1) Call \`xuezh snapshot\`.
2) Pick a tiny plan (1-2 bullets).
3) Run a short activity.
4) Log outcomes.

## CLI examples

\`\`\`bash
xuezh snapshot --profile default
xuezh review next --limit 10
xuezh audio process-voice --file ./utterance.wav
\`\`\`
`,
  },
  {
    slug: "hanzi-helper",
    displayName: "汉字助手",
    summary: "汉字学习与分析工具，支持笔画查询、部首检索和组词生成。",
    version: "0.1.0",
    metadata: {
      clawdbot: {
        nix: {
          plugin: "github:example/hanzi-helper",
          systems: ["aarch64-darwin", "x86_64-linux"],
        },
        config: {
          requiredEnv: ["HANZI_DB_PATH"],
          stateDirs: [".config/hanzi"],
          example:
            'config = { env = { HANZI_DB_PATH = ".config/hanzi/db"; }; stateDirs = [ ".config/hanzi" ]; };',
        },
        cliHelp: `汉字助手 - Chinese character learning and analysis

Usage:
  hanzi-helper [command]

Available Commands:
  lookup      查询汉字信息（笔画、部首、释义）
  radical     按部首检索汉字
  stroke      按笔画数筛选汉字
  words       生成汉字组词
  practice    练习汉字书写
  quiz        汉字听写测试

Flags:
  -h, --help   help for hanzi-helper
  --json       Output JSON
`,
      },
    },
    rawSkillMd: `---
name: hanzi-helper
description: 汉字学习与分析工具，提供笔画查询、部首检索、组词生成和汉字听写练习功能。
---

# 汉字助手

## 功能介绍

汉字助手是一个强大的中文汉字学习工具，帮助用户深入了解每个汉字的结构和含义。

## CLI

\`\`\`bash
hanzi-helper lookup --char 学
hanzi-helper radical --name 木
hanzi-helper stroke --count 8
hanzi-helper words --char 大 --limit 20
\`\`\`

## 使用场景

- **汉字查询**：输入任意汉字，查看笔画数、部首、繁体形式和基本释义
- **部首检索**：按部首浏览相关汉字，了解汉字的分类规律
- **组词生成**：输入一个汉字，自动生成常用词语和成语
- **听写练习**：随机生成汉字听写测试，巩固学习效果

## 学习建议

建议每天学习五个新汉字，结合组词和例句加深记忆。坚持使用听写练习功能可以有效提高汉字识别能力。
`,
  },
];

function injectMetadata(rawSkillMd: string, metadata: Record<string, unknown>) {
  const frontmatterEnd = rawSkillMd.indexOf("\n---", 3);
  if (frontmatterEnd === -1) return rawSkillMd;
  return `${rawSkillMd.slice(0, frontmatterEnd)}\nmetadata: ${JSON.stringify(
    metadata,
  )}${rawSkillMd.slice(frontmatterEnd)}`;
}

async function seedNixSkillsHandler(
  ctx: ActionCtx,
  args: SeedActionArgs,
): Promise<SeedActionResult> {
  const results: Array<Record<string, unknown> & { slug: string }> = [];

  for (const spec of SEED_SKILLS) {
    const skillMd = injectMetadata(spec.rawSkillMd, spec.metadata);
    const frontmatter = parseFrontmatter(skillMd);
    const clawdis = parseClawdisMetadata(frontmatter);
    const storageId = await ctx.storage.store(new Blob([skillMd], { type: "text/markdown" }));

    const result: SeedMutationResult = await ctx.runMutation(internal.devSeed.seedSkillMutation, {
      reset: args.reset,
      storageId,
      metadata: spec.metadata,
      frontmatter,
      clawdis,
      skillMd,
      slug: spec.slug,
      displayName: spec.displayName,
      summary: spec.summary,
      version: spec.version,
    });

    results.push({ slug: spec.slug, ...result });
  }

  return { ok: true, results };
}

export const seedNixSkills: ReturnType<typeof internalAction> = internalAction({
  args: {
    reset: v.optional(v.boolean()),
  },
  handler: seedNixSkillsHandler,
});

async function seedPadelSkillHandler(
  ctx: ActionCtx,
  args: SeedActionArgs,
): Promise<SeedMutationResult> {
  const spec = SEED_SKILLS.find((entry) => entry.slug === "padel");
  if (!spec) throw new Error("padel seed spec missing");

  const skillMd = injectMetadata(spec.rawSkillMd, spec.metadata);
  const frontmatter = parseFrontmatter(skillMd);
  const clawdis = parseClawdisMetadata(frontmatter);
  const storageId = await ctx.storage.store(new Blob([skillMd], { type: "text/markdown" }));

  return (await ctx.runMutation(internal.devSeed.seedSkillMutation, {
    reset: args.reset,
    storageId,
    metadata: spec.metadata,
    frontmatter,
    clawdis,
    skillMd,
    slug: spec.slug,
    displayName: spec.displayName,
    summary: spec.summary,
    version: spec.version,
  })) as SeedMutationResult;
}

export const seedPadelSkill: ReturnType<typeof internalAction> = internalAction({
  args: {
    reset: v.optional(v.boolean()),
  },
  handler: seedPadelSkillHandler,
});

export const seedSkillMutation = internalMutation({
  args: {
    reset: v.optional(v.boolean()),
    storageId: v.id("_storage"),
    metadata: v.any(),
    frontmatter: v.any(),
    clawdis: v.any(),
    skillMd: v.string(),
    slug: v.string(),
    displayName: v.string(),
    summary: v.optional(v.string()),
    version: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (existing && !args.reset) {
      return { ok: true, skipped: true, skillId: existing._id };
    }

    if (existing && args.reset) {
      const versions = await ctx.db
        .query("skillVersions")
        .withIndex("by_skill", (q) => q.eq("skillId", existing._id))
        .collect();
      for (const version of versions) {
        await ctx.db.delete(version._id);
      }
      const embeddings = await ctx.db
        .query("skillEmbeddings")
        .withIndex("by_skill", (q) => q.eq("skillId", existing._id))
        .collect();
      for (const embedding of embeddings) {
        await ctx.db.delete(embedding._id);
      }
      await ctx.db.delete(existing._id);
    }

    const now = Date.now();
    const existingUsers = await ctx.db
      .query("users")
      .withIndex("handle", (q) => q.eq("handle", "local"))
      .collect();

    const userId =
      existingUsers[0]?._id ??
      (await ctx.db.insert("users", {
        handle: "local",
        displayName: "Local Dev",
        role: "admin",
        createdAt: now,
        updatedAt: now,
      }));

    const skillId = await ctx.db.insert("skills", {
      slug: args.slug,
      displayName: args.displayName,
      summary: args.summary,
      ownerUserId: userId,
      latestVersionId: undefined,
      tags: {},
      softDeletedAt: undefined,
      badges: { redactionApproved: undefined },
      statsDownloads: 0,
      statsStars: 0,
      statsInstallsCurrent: 0,
      statsInstallsAllTime: 0,
      stats: {
        downloads: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        stars: 0,
        versions: 0,
        comments: 0,
      },
      createdAt: now,
      updatedAt: now,
    });

    const versionId = await ctx.db.insert("skillVersions", {
      skillId,
      version: args.version,
      changelog: "Seeded local version for screenshots.",
      files: [
        {
          path: "SKILL.md",
          size: args.skillMd.length,
          storageId: args.storageId,
          sha256: "seeded",
          contentType: "text/markdown",
        },
      ],
      parsed: {
        frontmatter: args.frontmatter,
        metadata: args.metadata,
        clawdis: args.clawdis,
      },
      createdBy: userId,
      createdAt: now,
      softDeletedAt: undefined,
    });

    const embeddingId = await ctx.db.insert("skillEmbeddings", {
      skillId,
      versionId,
      ownerId: userId,
      embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0),
      isLatest: true,
      isApproved: true,
      visibility: "latest-approved",
      updatedAt: now,
    });
    await ctx.db.insert("embeddingSkillMap", { embeddingId, skillId });

    await ctx.db.patch(skillId, {
      latestVersionId: versionId,
      tags: { latest: versionId },
      statsDownloads: 0,
      statsStars: 0,
      statsInstallsCurrent: 0,
      statsInstallsAllTime: 0,
      stats: {
        downloads: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        stars: 0,
        versions: 1,
        comments: 0,
      },
      updatedAt: now,
    });

    return { ok: true, skillId, versionId, embeddingId };
  },
});
