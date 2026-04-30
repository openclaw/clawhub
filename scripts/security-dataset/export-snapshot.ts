import { execFile, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { artifactInputsFromConvexExportZip } from "./convexExport";
import { parseConvexJsonMatching } from "./convexOutput";
import { reserveExportInputs } from "./exportLimit";
import { buildSecurityDatasetManifest } from "./manifest";
import {
	normalizeArtifactExport,
	type ArtifactExportInput,
	type NormalizedDatasetRows,
	type SourceKind,
} from "./normalize";
import {
	assertCreatedTimeWindow,
	clampCreatedBounds,
	emptyCreatedTimeWindow,
	parseCreatedTimestamp,
	type CreatedTimeWindow,
} from "./timeWindow";

const execFileAsync = promisify(execFile);

type ConvexPage = {
	page: ArtifactExportInput[];
	isDone: boolean;
	continueCursor: string;
	exportMode: "public";
};

type ConvexBounds = {
	sourceKind: SourceKind;
	minCreatedAt: number | null;
	maxCreatedAt: number | null;
};

type Options = {
	deployment: string | null;
	prod: boolean;
	push: boolean;
	dryRun: boolean;
	mode: "public";
	limit: number | null;
	pageSize: number;
	batchPages: number;
	concurrency: number;
	shards: number;
	outDir: string;
	sourceKind: SourceKind | "all";
	timeWindow: CreatedTimeWindow;
	convexExportZip: string | null;
};

type ExportShard = {
	sourceKind: SourceKind;
	createdAtGte?: number;
	createdAtLt?: number;
	label: string;
};

type SnapshotState = {
	sourceArtifacts: number;
	rowCounts: {
		artifacts: number;
		scanResults: number;
		staticFindings: number;
		labels: number;
		splits: number;
	};
	scannerVersions: Set<string>;
	modelNames: Set<string>;
};

type SnapshotWriters = {
	artifacts: WriteStream;
	scanResults: WriteStream;
	staticFindings: WriteStream;
	labels: WriteStream;
	splits: WriteStream;
};

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_BATCH_PAGES = 5;
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_SHARDS = 12;
const DEFAULT_MAX_CONVEX_ATTEMPTS = 6;
const DEFAULT_OUT_DIR = ".data/security-dataset/snapshots";
const CONVEX_RUN_MAX_BUFFER_BYTES = 128 * 1024 * 1024;
const SOURCE_KINDS: SourceKind[] = ["skill", "package"];

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const snapshotId = buildSnapshotId(options);
	const snapshotDir = resolve(options.outDir, snapshotId);
	const writers = options.dryRun ? null : await openSnapshotWriters(snapshotDir);
	let writersClosed = false;
	const state = createSnapshotState();

	try {
		const shardCount = options.convexExportZip
			? await exportConvexExportZip({ options, state, writers })
			: await exportRemoteShards({ options, state, writers });
		const manifest = buildManifest({ options, snapshotId, state, shardCount });

		if (options.dryRun) {
			console.log(JSON.stringify({ snapshotId, dryRun: true, manifest }, null, 2));
			return;
		}

		if (!writers) throw new Error("Snapshot writers were not opened.");
		await closeSnapshotWriters(writers);
		writersClosed = true;
		await writeFile(join(snapshotDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

		console.log(JSON.stringify({ snapshotId, snapshotDir, manifest }, null, 2));
	} catch (error) {
		if (writers && !writersClosed) await closeSnapshotWriters(writers).catch(() => {});
		throw error;
	}
}

async function exportRemoteShards(input: {
	options: Options;
	state: SnapshotState;
	writers: SnapshotWriters | null;
}) {
	const { options, state, writers } = input;
	const shards = await buildExportShards(options);
	await exportShards({ options, shards, state, writers });
	return shards.length;
}

async function exportConvexExportZip(input: {
	options: Options;
	state: SnapshotState;
	writers: SnapshotWriters | null;
}) {
	const { options, state, writers } = input;
	if (!options.convexExportZip) throw new Error("Missing Convex export ZIP path.");
	const inputs = await artifactInputsFromConvexExportZip(options.convexExportZip);
	const reserved = reserveExportInputs(
		filterExportInputs(inputs, options.sourceKind, options.timeWindow),
		state,
		options.limit,
	);
	await processArtifactInputs({ inputs: reserved, state, writers });
	console.error(
		`[snapshot] convex-export +${reserved.length} artifacts (${state.sourceArtifacts} total)`,
	);
	return 0;
}

function filterExportInputs(
	inputs: ArtifactExportInput[],
	sourceKind: SourceKind | "all",
	timeWindow: CreatedTimeWindow,
) {
	return inputs.filter((input) => {
		if (sourceKind !== "all" && input.sourceKind !== sourceKind) return false;
		if (timeWindow.createdAtGte !== undefined && input.createdAt < timeWindow.createdAtGte)
			return false;
		if (timeWindow.createdAtLt !== undefined && input.createdAt >= timeWindow.createdAtLt)
			return false;
		return true;
	});
}

async function buildExportShards(options: Options) {
	const sourceKinds = options.sourceKind === "all" ? SOURCE_KINDS : [options.sourceKind];
	const shards: ExportShard[] = [];

	for (const sourceKind of sourceKinds) {
		const bounds = await runConvexBounds(options, sourceKind);
		shards.push(...boundsToShards(clampCreatedBounds(bounds, options.timeWindow), options.shards));
	}

	return shards;
}

async function exportShards(input: {
	options: Options;
	shards: ExportShard[];
	state: SnapshotState;
	writers: SnapshotWriters | null;
}) {
	const { options, shards, state, writers } = input;
	await runWithConcurrency(shards, options.concurrency, async (shard) => {
		await exportShard({ options, shard, state, writers });
	});
}

async function exportShard(input: {
	options: Options;
	shard: ExportShard;
	state: SnapshotState;
	writers: SnapshotWriters | null;
}) {
	const { options, shard, state, writers } = input;
	let cursor: string | null = null;
	while (!isLimitReached(options, state)) {
		const page = await runConvexPage(options, shard, cursor, options.pageSize);
		const inputs = reserveExportInputs(page.page, state, options.limit);
		if (inputs.length > 0) {
			await processArtifactInputs({ inputs, state, writers });
			console.error(
				`[snapshot] ${shard.label} +${inputs.length} artifacts (${state.sourceArtifacts} total)`,
			);
		}
		if (page.isDone || inputs.length < page.page.length) return;
		cursor = page.continueCursor;
	}
}

async function runConvexPage(
	options: Options,
	shard: ExportShard,
	cursor: string | null,
	numItems: number,
): Promise<ConvexPage> {
	const args = {
		sourceKind: shard.sourceKind,
		mode: options.mode,
		createdAtGte: shard.createdAtGte,
		createdAtLt: shard.createdAtLt,
		paginationOpts: { cursor, numItems },
		pageCount: options.batchPages,
	};
	return runConvexJson<ConvexPage>(
		options,
		"securityDataset:listArtifactExportBatchInternal",
		args,
		isConvexPage,
	);
}

async function runConvexBounds(options: Options, sourceKind: SourceKind): Promise<ConvexBounds> {
	return runConvexJson<ConvexBounds>(
		options,
		"securityDataset:getArtifactExportBoundsInternal",
		{ sourceKind },
		isConvexBounds,
	);
}

async function runConvexJson<T>(
	options: Options,
	functionName: string,
	args: unknown,
	validate: (value: unknown) => value is T,
): Promise<T> {
	const commandArgs = buildConvexRunArgs(options, functionName, args);
	let lastError: unknown = null;
	for (let attempt = 1; attempt <= DEFAULT_MAX_CONVEX_ATTEMPTS; attempt += 1) {
		try {
			const result = await execFileAsync("bunx", commandArgs, {
				cwd: process.cwd(),
				encoding: "utf8",
				env: convexRunEnv(),
				maxBuffer: CONVEX_RUN_MAX_BUFFER_BYTES,
			});
			return parseConvexJsonMatching(result.stdout, validate);
		} catch (error) {
			lastError = error;
			if (attempt === DEFAULT_MAX_CONVEX_ATTEMPTS) break;
			console.error(
				`[snapshot] retrying ${functionName} after attempt ${attempt}: ${errorMessage(error)}`,
			);
			await delay(attempt * 500);
		}
	}

	writeCommandErrorOutput(lastError);
	throw lastError;
}

function convexRunEnv() {
	const { FORCE_COLOR: _forceColor, ...env } = process.env;
	return { ...env, NO_COLOR: "1" };
}

function buildManifest(input: {
	options: Options;
	snapshotId: string;
	state: SnapshotState;
	shardCount: number;
}) {
	const { options, snapshotId, state, shardCount } = input;
	const repoGitSha = gitSha();
	return buildSecurityDatasetManifest({
		snapshotId,
		createdAt: new Date().toISOString(),
		repoGitSha,
		convexDeployment: options.deployment ?? (options.prod ? "prod" : "configured-dev"),
		exportMode: options.mode,
		pageSize: options.pageSize,
		concurrency: options.concurrency,
		shards: options.shards,
		shardCount,
		rowCounts: {
			sourceArtifacts: state.sourceArtifacts,
			artifacts: state.rowCounts.artifacts,
			scanResults: state.rowCounts.scanResults,
			staticFindings: state.rowCounts.staticFindings,
			labels: state.rowCounts.labels,
			splits: state.rowCounts.splits,
		},
		scannerVersions: Array.from(state.scannerVersions).sort(),
		modelNames: Array.from(state.modelNames).sort(),
		redactionPolicyVersion: "public-signals-v1",
		sourceTables: ["skillVersions", "packageReleases"],
		timeWindow: options.timeWindow,
	});
}

function buildSnapshotId(options: Options) {
	const timestamp = new Date()
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}Z$/, "Z");
	const deployment =
		options.deployment?.replace(/[^a-zA-Z0-9]+/g, "-") ?? (options.prod ? "prod" : "dev");
	return `clawhub-${deployment}-${timestamp}-${gitSha().slice(0, 8)}`;
}

function createSnapshotState(): SnapshotState {
	return {
		sourceArtifacts: 0,
		rowCounts: {
			artifacts: 0,
			scanResults: 0,
			staticFindings: 0,
			labels: 0,
			splits: 0,
		},
		scannerVersions: new Set(),
		modelNames: new Set(),
	};
}

async function processArtifactInputs(input: {
	inputs: ArtifactExportInput[];
	state: SnapshotState;
	writers: SnapshotWriters | null;
}) {
	const { inputs, state, writers } = input;
	const rows = normalizeArtifactExport(inputs);
	state.rowCounts.artifacts += rows.artifacts.length;
	state.rowCounts.scanResults += rows.scanResults.length;
	state.rowCounts.staticFindings += rows.staticFindings.length;
	state.rowCounts.labels += rows.labels.length;
	state.rowCounts.splits += rows.splits.length;
	for (const row of rows.scanResults) {
		if (row.scanner_version) state.scannerVersions.add(row.scanner_version);
		if (row.model) state.modelNames.add(row.model);
	}

	if (!writers) return;
	await writeNormalizedRows(writers, rows);
}

async function openSnapshotWriters(snapshotDir: string): Promise<SnapshotWriters> {
	await mkdir(snapshotDir, { recursive: true });
	return {
		artifacts: createWriteStream(join(snapshotDir, "artifacts.jsonl"), { encoding: "utf8" }),
		scanResults: createWriteStream(join(snapshotDir, "scan_results.jsonl"), { encoding: "utf8" }),
		staticFindings: createWriteStream(join(snapshotDir, "static_findings.jsonl"), {
			encoding: "utf8",
		}),
		labels: createWriteStream(join(snapshotDir, "labels.jsonl"), { encoding: "utf8" }),
		splits: createWriteStream(join(snapshotDir, "splits.jsonl"), { encoding: "utf8" }),
	};
}

async function closeSnapshotWriters(writers: SnapshotWriters) {
	await Promise.all(Object.values(writers).map((stream) => endStream(stream)));
}

async function endStream(stream: WriteStream) {
	stream.end();
	await once(stream, "finish");
}

async function writeNormalizedRows(writers: SnapshotWriters, rows: NormalizedDatasetRows) {
	await writeJsonlRows(writers.artifacts, rows.artifacts);
	await writeJsonlRows(writers.scanResults, rows.scanResults);
	await writeJsonlRows(writers.staticFindings, rows.staticFindings);
	await writeJsonlRows(writers.labels, rows.labels);
	await writeJsonlRows(writers.splits, rows.splits);
}

async function writeJsonlRows(stream: WriteStream, rows: unknown[]) {
	if (rows.length === 0) return;
	const chunk = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
	if (!stream.write(chunk)) await once(stream, "drain");
}

function boundsToShards(bounds: ConvexBounds, shardCount: number): ExportShard[] {
	if (bounds.minCreatedAt === null || bounds.maxCreatedAt === null) return [];
	const start = bounds.minCreatedAt;
	const end = bounds.maxCreatedAt + 1;
	const span = Math.max(1, end - start);
	const width = Math.ceil(span / shardCount);
	const shards: ExportShard[] = [];
	for (let shardIndex = 0; shardIndex < shardCount; shardIndex += 1) {
		const createdAtGte = start + shardIndex * width;
		const createdAtLt = Math.min(end, createdAtGte + width);
		if (createdAtGte >= end) break;
		shards.push({
			sourceKind: bounds.sourceKind,
			createdAtGte,
			createdAtLt,
			label: `${bounds.sourceKind}:${shardIndex + 1}/${shardCount}`,
		});
	}
	return shards;
}

function buildConvexRunArgs(options: Options, functionName: string, args: unknown) {
	const commandArgs = ["convex", "run"];
	if (options.prod) commandArgs.push("--prod");
	if (options.deployment) commandArgs.push("--deployment", options.deployment);
	if (options.push) commandArgs.push("--push", "--typecheck=disable");
	commandArgs.push(functionName, JSON.stringify(args));
	return commandArgs;
}

async function runWithConcurrency<T>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<void>,
) {
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, async () => {
			while (true) {
				const index = next;
				next += 1;
				if (index >= items.length) return;
				await worker(items[index]!);
			}
		}),
	);
}

function isLimitReached(options: Options, state: SnapshotState) {
	return options.limit !== null && state.sourceArtifacts >= options.limit;
}

function isConvexPage(value: unknown): value is ConvexPage {
	return (
		isRecord(value) &&
		Array.isArray(value.page) &&
		typeof value.isDone === "boolean" &&
		typeof value.continueCursor === "string" &&
		value.exportMode === "public"
	);
}

function isConvexBounds(value: unknown): value is ConvexBounds {
	return (
		isRecord(value) &&
		(value.sourceKind === "skill" || value.sourceKind === "package") &&
		(typeof value.minCreatedAt === "number" || value.minCreatedAt === null) &&
		(typeof value.maxCreatedAt === "number" || value.maxCreatedAt === null)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function delay(ms: number) {
	return new Promise<void>((done) => setTimeout(done, ms));
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function writeCommandErrorOutput(error: unknown) {
	if (!isRecord(error)) return;
	if (typeof error.stderr === "string" && error.stderr.length > 0) {
		process.stderr.write(error.stderr);
	} else if (typeof error.stdout === "string" && error.stdout.length > 0) {
		process.stderr.write(error.stdout);
	}
}

function gitSha() {
	const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
	if (result.status !== 0) return "unknown";
	return result.stdout.trim();
}

function parseArgs(args: string[]): Options {
	const options: Options = {
		deployment: null,
		prod: false,
		push: false,
		dryRun: false,
		mode: "public",
		limit: null,
		pageSize: DEFAULT_PAGE_SIZE,
		batchPages: DEFAULT_BATCH_PAGES,
		concurrency: DEFAULT_CONCURRENCY,
		shards: DEFAULT_SHARDS,
		outDir: DEFAULT_OUT_DIR,
		sourceKind: "all",
		timeWindow: emptyCreatedTimeWindow(),
		convexExportZip: null,
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--prod") {
			options.prod = true;
		} else if (arg === "--push") {
			options.push = true;
		} else if (arg === "--dry-run") {
			options.dryRun = true;
		} else if (arg === "--deployment") {
			options.deployment = readValue(args, ++index, arg);
		} else if (arg === "--limit") {
			options.limit = readPositiveInt(readValue(args, ++index, arg), arg);
		} else if (arg === "--page-size") {
			options.pageSize = readPositiveInt(readValue(args, ++index, arg), arg);
		} else if (arg === "--batch-pages") {
			options.batchPages = readPositiveInt(readValue(args, ++index, arg), arg);
		} else if (arg === "--concurrency") {
			options.concurrency = readPositiveInt(readValue(args, ++index, arg), arg);
		} else if (arg === "--shards") {
			options.shards = readPositiveInt(readValue(args, ++index, arg), arg);
		} else if (arg === "--out-dir") {
			options.outDir = readValue(args, ++index, arg);
		} else if (arg === "--source-kind") {
			options.sourceKind = readSourceKind(readValue(args, ++index, arg));
		} else if (arg === "--created-after") {
			options.timeWindow.createdAtGte = parseCreatedTimestamp(readValue(args, ++index, arg), arg);
		} else if (arg === "--created-before") {
			options.timeWindow.createdAtLt = parseCreatedTimestamp(readValue(args, ++index, arg), arg);
		} else if (arg === "--convex-export-zip" || arg === "--from-convex-export") {
			options.convexExportZip = readValue(args, ++index, arg);
		} else if (arg === "--mode") {
			const mode = readValue(args, ++index, arg);
			if (mode !== "public") throw new Error(`Unsupported mode: ${mode}`);
			options.mode = mode;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}

	if (options.prod && options.deployment) {
		throw new Error("Use either --prod or --deployment, not both.");
	}
	assertCreatedTimeWindow(options.timeWindow);
	return options;
}

function readValue(args: string[], index: number, flag: string) {
	const value = args[index];
	if (!value) throw new Error(`Missing value for ${flag}`);
	return value;
}

function readPositiveInt(value: string, flag: string) {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0)
		throw new Error(`Expected positive integer for ${flag}`);
	return parsed;
}

function readSourceKind(value: string): SourceKind | "all" {
	if (value === "all" || value === "skill" || value === "package") return value;
	throw new Error(`Unsupported source kind: ${value}`);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
