import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import {
  type PublicCorpusDummyOwner,
  type PublicCorpusSeedBatchHandlerResult,
  type PublicCorpusSeedRow,
  seedLocalFixturesHandler,
  seedPublicCorpusBatchHandler,
} from "./devSeed";
import { internalAction } from "./functions";
import { assertPreviewSeedAllowed } from "./lib/devSeed";

const PREVIEW_OWNER: PublicCorpusDummyOwner = {
  handle: "preview-publisher",
  displayName: "Preview Publisher",
  image: "https://avatars.githubusercontent.com/u/9919?v=4",
};

const PREVIEW_PLUGIN_OWNER: PublicCorpusDummyOwner = {
  handle: "preview-plugins",
  displayName: "Preview Plugins",
  image: "https://avatars.githubusercontent.com/u/69631?v=4",
};

export const PREVIEW_SEED_ROWS: PublicCorpusSeedRow[] = [
  {
    kind: "skill",
    slug: "preview-search-assistant",
    displayName: "Preview Search Assistant",
    version: "1.0.0",
    summary: "Deterministic preview fixture for browse, search, and skill detail pages.",
    skillMd: `---
name: preview-search-assistant
description: Deterministic preview fixture for browse, search, and skill detail pages.
---

# Preview Search Assistant

Search a local knowledge base and return concise citations.
`,
    createdAt: Date.parse("2026-01-10T12:00:00.000Z"),
    dummyOwner: PREVIEW_OWNER,
  },
  {
    kind: "skill",
    slug: "preview-release-notes",
    displayName: "Preview Release Notes",
    version: "2.1.0",
    summary: "Summarize release notes into operator-ready highlights.",
    skillMd: `---
name: preview-release-notes
description: Summarize release notes into operator-ready highlights.
---

# Preview Release Notes

Group changes by impact, call out breaking changes, and preserve source links.
`,
    createdAt: Date.parse("2026-02-12T09:30:00.000Z"),
    dummyOwner: PREVIEW_OWNER,
  },
  {
    kind: "plugin",
    name: "@preview/discord-channel",
    displayName: "Preview Discord Channel",
    version: "0.4.0",
    summary: "Synthetic public channel plugin with deterministic catalog metadata.",
    readme: `# Preview Discord Channel

Synthetic public plugin used to exercise ClawHub preview browse and detail pages.
`,
    categories: ["channels"],
    topics: ["Discord", "Messaging"],
    family: "code-plugin",
    channel: "community",
    sourceRepoHost: "openclaw/clawhub",
    createdAt: Date.parse("2026-03-15T18:45:00.000Z"),
    dummyOwner: PREVIEW_PLUGIN_OWNER,
  },
  {
    kind: "plugin",
    name: "@preview/automation-bundle",
    displayName: "Preview Automation Bundle",
    version: "1.2.3",
    summary: "Synthetic bundle plugin for category and security presentation.",
    readme: `# Preview Automation Bundle

Synthetic bundle fixture with stable stats, validation warnings, and release metadata.
`,
    categories: ["tools", "runtime"],
    topics: ["Automation", "Workflows", "Productivity"],
    family: "bundle-plugin",
    channel: "community",
    sourceRepoHost: "openclaw/clawhub",
    createdAt: Date.parse("2026-04-20T14:15:00.000Z"),
    dummyOwner: PREVIEW_PLUGIN_OWNER,
  },
];

type PreviewSeedResult = {
  ok: true;
  catalog: PublicCorpusSeedBatchHandlerResult;
  moderation: {
    ok: true;
    results: Array<Record<string, unknown> & { slug: string }>;
  };
};

export async function seedPreviewHandler(ctx: ActionCtx): Promise<PreviewSeedResult> {
  assertPreviewSeedAllowed("ClawHub PR preview");

  const ownerHandles = [PREVIEW_OWNER.handle, PREVIEW_PLUGIN_OWNER.handle];
  const catalog: PublicCorpusSeedBatchHandlerResult = await seedPublicCorpusBatchHandler(ctx, {
    reset: true,
    resetOwnerHandles: ownerHandles,
    rows: PREVIEW_SEED_ROWS,
  });
  const moderation = await seedLocalFixturesHandler(ctx, { reset: true });

  return {
    ok: true as const,
    catalog,
    moderation,
  };
}

export const seed: ReturnType<typeof internalAction> = internalAction({
  args: {},
  returns: v.object({
    ok: v.literal(true),
    catalog: v.object({
      ok: v.literal(true),
      seeded: v.array(v.string()),
      skipped: v.array(v.string()),
    }),
    moderation: v.object({
      ok: v.literal(true),
      results: v.array(v.record(v.string(), v.any())),
    }),
  }),
  handler: seedPreviewHandler,
});
