import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalQuery } from "./functions";

const MAX_EXPORT_PAGE_SIZE = 50;
type StoredVtAnalysis = Doc<"skillVersions">["vtAnalysis"];
type StoredLlmAnalysis = Doc<"skillVersions">["llmAnalysis"];

export const listArtifactExportPageInternal = internalQuery({
	args: {
		sourceKind: v.union(v.literal("skill"), v.literal("package")),
		mode: v.optional(v.literal("public")),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, args) => {
		const paginationOpts = {
			cursor: args.paginationOpts.cursor,
			numItems: Math.min(args.paginationOpts.numItems, MAX_EXPORT_PAGE_SIZE),
		};
		if (args.sourceKind === "skill") {
			const page = await ctx.db
				.query("skillVersions")
				.withIndex("by_active_created", (q) => q.eq("softDeletedAt", undefined))
				.order("asc")
				.paginate(paginationOpts);
			return {
				page: await skillVersionPageToExportRows(ctx, page.page),
				isDone: page.isDone,
				continueCursor: page.continueCursor,
				exportMode: args.mode ?? "public",
			};
		}

		const page = await ctx.db
			.query("packageReleases")
			.withIndex("by_active_created", (q) => q.eq("softDeletedAt", undefined))
			.order("asc")
			.paginate(paginationOpts);
		return {
			page: await packageReleasePageToExportRows(ctx, page.page),
			isDone: page.isDone,
			continueCursor: page.continueCursor,
			exportMode: args.mode ?? "public",
		};
	},
});

async function skillVersionPageToExportRows(ctx: QueryCtx, versions: Array<Doc<"skillVersions">>) {
	const rows = [];
	for (const version of versions) {
		const skill = await ctx.db.get(version.skillId);
		if (!skill || skill.softDeletedAt) continue;
		rows.push({
			sourceKind: "skill" as const,
			sourceDocId: version._id,
			parentDocId: skill._id,
			publicName: skill.displayName,
			publicSlug: skill.slug,
			version: version.version,
			artifactSha256: version.sha256hash ?? null,
			createdAt: version.createdAt,
			softDeletedAt: version.softDeletedAt ?? null,
			files: sanitizeFiles(version.files),
			capabilityTags: version.capabilityTags ?? skill.capabilityTags ?? [],
			packageFamily: null,
			packageChannel: null,
			packageExecutesCode: null,
			sourceRepoHost: null,
			vtAnalysis: normalizeVtAnalysis(version.vtAnalysis),
			staticScan: version.staticScan ?? null,
			llmAnalysis: normalizeLlmAnalysis(version.llmAnalysis),
			moderationConsensus:
				skill.moderationSourceVersionId === version._id
					? {
							verdict: skill.moderationVerdict ?? null,
							reasonCodes: skill.moderationReasonCodes ?? [],
							summary: skill.moderationSummary ?? null,
							engineVersion: skill.moderationEngineVersion ?? null,
							evaluatedAt: skill.moderationEvaluatedAt ?? null,
						}
					: null,
		});
	}
	return rows;
}

async function packageReleasePageToExportRows(
	ctx: QueryCtx,
	releases: Array<Doc<"packageReleases">>,
) {
	const rows = [];
	for (const release of releases) {
		const pkg = await ctx.db.get(release.packageId);
		if (!pkg || pkg.softDeletedAt || pkg.channel === "private") continue;
		rows.push({
			sourceKind: "package" as const,
			sourceDocId: release._id,
			parentDocId: pkg._id,
			publicName: pkg.displayName,
			publicSlug: pkg.name,
			version: release.version,
			artifactSha256: release.sha256hash ?? release.integritySha256,
			createdAt: release.createdAt,
			softDeletedAt: release.softDeletedAt ?? null,
			files: sanitizeFiles(release.files),
			capabilityTags: pkg.capabilityTags ?? [],
			packageFamily: pkg.family,
			packageChannel: pkg.channel,
			packageExecutesCode: pkg.executesCode ?? null,
			sourceRepoHost: sourceRepoHost(pkg.sourceRepo),
			vtAnalysis: normalizeVtAnalysis(release.vtAnalysis),
			staticScan: release.staticScan ?? null,
			llmAnalysis: normalizeLlmAnalysis(release.llmAnalysis),
			moderationConsensus: null,
		});
	}
	return rows;
}

function sanitizeFiles(files: Array<Doc<"skillVersions">["files"][number]>) {
	return files.map((file) => ({
		path: file.path,
		size: file.size,
		sha256: file.sha256,
		contentType: file.contentType ?? null,
	}));
}

function normalizeVtAnalysis(analysis: StoredVtAnalysis) {
	if (!analysis) return null;
	return {
		status: analysis.status,
		verdict: analysis.verdict ?? null,
		analysis: analysis.analysis ?? null,
		source: analysis.source ?? null,
		scanner: analysis.scanner ?? null,
		engineStats: analysis.engineStats ?? null,
		checkedAt: analysis.checkedAt,
	};
}

function normalizeLlmAnalysis(analysis: StoredLlmAnalysis) {
	if (!analysis) return null;
	return {
		status: analysis.status,
		verdict: analysis.verdict ?? null,
		confidence: analysis.confidence ?? null,
		summary: analysis.summary ?? null,
		dimensions: analysis.dimensions ?? null,
		guidance: analysis.guidance ?? null,
		findings: analysis.findings ?? null,
		model: analysis.model ?? null,
		checkedAt: analysis.checkedAt,
	};
}

function sourceRepoHost(sourceRepo: string | undefined) {
	if (!sourceRepo) return null;
	try {
		return new URL(sourceRepo).host.toLowerCase();
	} catch {
		const match = sourceRepo.match(/^[^/:]+[:/](?<owner>[^/]+)\/(?<repo>[^/]+)$/);
		return match?.groups?.owner && match.groups.repo ? "github.com" : null;
	}
}
