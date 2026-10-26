import {
  normalizeThemeDefinition,
  type ThemeDefinition,
  type ThemeRelease,
  type ThemeSummary,
} from "clawhub-schema";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import semver from "semver";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./functions";
import {
  getPublisherByHandle,
  isPublisherActive,
  PUBLISHER_HANDLE_PATTERN,
  resolvePublisherForActor,
} from "./lib/publishers";
import { hashToken } from "./lib/tokens";

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function summary(theme: Doc<"themes">, handle: string): ThemeSummary {
  return {
    id: handle + "/" + theme.slug,
    name: theme.name,
    description: theme.description,
    version: theme.version,
    category: "themes",
    author: { handle },
    updatedAt: theme.updatedAt,
  };
}

async function publicOwner(ctx: QueryCtx, theme: Doc<"themes">) {
  if (!theme.listed) return null;
  const publisher = await ctx.db.get(theme.ownerPublisherId);
  if (!isPublisherActive(publisher) || !publisher) return null;
  if (publisher.linkedUserId) {
    const user = await ctx.db.get(publisher.linkedUserId);
    if (!user || user.deletedAt || user.deactivatedAt) return null;
  }
  return publisher;
}

export const listInternal = internalQuery({
  args: { paginationOpts: paginationOptsValidator, query: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const query = args.query?.trim() ?? "";
    if (query.length > 200) throw new ConvexError("Theme query exceeds 200 characters");
    // Publisher handles can be renamed. Resolve exact owner queries from the
    // publisher owner rather than retaining mutable handles in searchText.
    const publisher = query ? await getPublisherByHandle(ctx, query) : null;
    const result = publisher
      ? await ctx.db
          .query("themes")
          .withIndex("by_ownerPublisherId_and_listed", (q) =>
            q.eq("ownerPublisherId", publisher._id).eq("listed", true),
          )
          .paginate(args.paginationOpts)
      : query
        ? await ctx.db
            .query("themes")
            .withSearchIndex("search_text", (q) => q.search("searchText", query).eq("listed", true))
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("themes")
            .withIndex("by_listed_and_updatedAt", (q) => q.eq("listed", true))
            .order("desc")
            .paginate(args.paginationOpts);
    const items: ThemeSummary[] = [];
    for (const theme of result.page) {
      const owner = await publicOwner(ctx, theme);
      if (!owner) continue;
      const release = await ctx.db
        .query("themeVersions")
        .withIndex("by_themeId_and_version", (q) =>
          q.eq("themeId", theme._id).eq("version", theme.version),
        )
        .unique();
      if (release && !release.withdrawn) items.push(summary(theme, owner.handle));
    }
    return { items, nextCursor: result.isDone ? null : result.continueCursor };
  },
});

export const getInternal = internalQuery({
  args: { owner: v.string(), slug: v.string(), version: v.optional(v.string()) },
  handler: async (ctx, args): Promise<ThemeRelease | null> => {
    if (!PUBLISHER_HANDLE_PATTERN.test(args.owner) || !SLUG.test(args.slug)) return null;
    const publisher = await getPublisherByHandle(ctx, args.owner);
    if (!publisher) return null;
    const theme = await ctx.db
      .query("themes")
      .withIndex("by_ownerPublisherId_and_slug", (q) =>
        q.eq("ownerPublisherId", publisher._id).eq("slug", args.slug),
      )
      .unique();
    if (!theme || !(await publicOwner(ctx, theme))) return null;
    const release = await ctx.db
      .query("themeVersions")
      .withIndex("by_themeId_and_version", (q) =>
        q.eq("themeId", theme._id).eq("version", args.version ?? theme.version),
      )
      .unique();
    if (!release || release.withdrawn) return null;
    // Only publishInternal writes this canonical, validated JSON; it is never executable.
    const definition = JSON.parse(release.definitionJson) as ThemeDefinition;
    return {
      ...summary(theme, publisher.handle),
      name: definition.name,
      description: definition.description,
      version: release.version,
      updatedAt: release.createdAt,
      definition,
      sha256: release.sha256,
    };
  },
});

export const publishInternal = internalMutation({
  args: {
    apiTokenId: v.id("apiTokens"),
    owner: v.string(),
    slug: v.string(),
    version: v.string(),
    definition: v.any(),
  },
  handler: async (ctx, args) => {
    const token = await ctx.db.get(args.apiTokenId);
    if (!token || token.revokedAt) throw new ConvexError("Unauthorized");
    const actor = await ctx.db.get(token.userId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
    if (!PUBLISHER_HANDLE_PATTERN.test(args.owner) || !SLUG.test(args.slug))
      throw new ConvexError("Invalid theme owner/name");
    if (semver.valid(args.version) !== args.version || args.version.length > 64)
      throw new ConvexError("Invalid theme version");
    let definition: ThemeDefinition;
    try {
      definition = normalizeThemeDefinition(args.definition);
    } catch (error) {
      throw new ConvexError(error instanceof Error ? error.message : "Invalid theme definition");
    }
    const definitionJson = JSON.stringify(definition);
    const sha256 = await hashToken(definitionJson);
    const publisher = await resolvePublisherForActor(ctx, {
      actor,
      ownerHandle: args.owner,
      allowed: ["publisher"],
    });
    if (!publisher) throw new ConvexError("Publisher not found");
    const theme = await ctx.db
      .query("themes")
      .withIndex("by_ownerPublisherId_and_slug", (q) =>
        q.eq("ownerPublisherId", publisher._id).eq("slug", args.slug),
      )
      .unique();
    if (theme) {
      const existing = await ctx.db
        .query("themeVersions")
        .withIndex("by_themeId_and_version", (q) =>
          q.eq("themeId", theme._id).eq("version", args.version),
        )
        .unique();
      if (existing) {
        if (existing.definitionJson !== definitionJson || existing.withdrawn)
          throw new ConvexError("Theme version already exists");
        return { id: publisher.handle + "/" + args.slug, version: args.version, sha256 };
      }
    }
    const now = Date.now();
    const fields = {
      name: definition.name,
      description: definition.description,
      version: args.version,
      searchText: [args.slug, definition.name, definition.description].join(" "),
      updatedAt: now,
    };
    const themeId =
      theme?._id ??
      (await ctx.db.insert("themes", {
        ownerPublisherId: publisher._id,
        slug: args.slug,
        listed: true,
        ...fields,
      }));
    await ctx.db.insert("themeVersions", {
      themeId,
      version: args.version,
      definitionJson,
      sha256,
      createdAt: now,
      withdrawn: false,
    });
    // Publishing an older version does not downgrade the latest release.
    if (theme && semver.gt(args.version, theme.version)) await ctx.db.patch(themeId, fields);
    return { id: publisher.handle + "/" + args.slug, version: args.version, sha256 };
  },
});
