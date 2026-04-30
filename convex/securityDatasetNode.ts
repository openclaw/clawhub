"use node";

import { gzipSync } from "node:zlib";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./functions";

const MAX_EXPORT_BATCH_PAGES = 20;

type ArtifactExportPage = {
	page: unknown[];
	isDone: boolean;
	continueCursor: string;
	exportMode: "public";
};

export const listArtifactExportBatchCompressedInternal = internalAction({
	args: {
		sourceKind: v.union(v.literal("skill"), v.literal("package")),
		mode: v.optional(v.literal("public")),
		createdAtGte: v.optional(v.number()),
		createdAtLt: v.optional(v.number()),
		paginationOpts: paginationOptsValidator,
		pageCount: v.number(),
	},
	handler: async (ctx, args) => {
		const pageCount = Math.min(Math.max(1, Math.floor(args.pageCount)), MAX_EXPORT_BATCH_PAGES);
		let cursor = args.paginationOpts.cursor;
		const page: ArtifactExportPage["page"] = [];
		let isDone = false;
		for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
			const result: ArtifactExportPage = await ctx.runQuery(
				internal.securityDataset.listArtifactExportPageInternal,
				{
					sourceKind: args.sourceKind,
					mode: args.mode,
					createdAtGte: args.createdAtGte,
					createdAtLt: args.createdAtLt,
					paginationOpts: {
						cursor,
						numItems: args.paginationOpts.numItems,
					},
				},
			);
			page.push(...result.page);
			cursor = result.continueCursor;
			isDone = result.isDone;
			if (isDone) break;
		}
		const json = JSON.stringify({
			page,
			isDone,
			continueCursor: cursor,
			exportMode: args.mode ?? "public",
		});
		return {
			encoding: "gzip-base64-json" as const,
			payload: gzipSync(json).toString("base64"),
		};
	},
});
