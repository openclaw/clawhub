import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	normalizeArtifactExport,
	type ArtifactExportInput,
	type NormalizedDatasetRows,
	type SourceKind,
} from "./normalize";

type ConvexPage = {
	page: ArtifactExportInput[];
	isDone: boolean;
	continueCursor: string;
	exportMode: "public";
};

type Options = {
	deployment: string | null;
	prod: boolean;
	push: boolean;
	dryRun: boolean;
	mode: "public";
	limit: number | null;
	pageSize: number;
	outDir: string;
	sourceKind: SourceKind | "all";
};

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_OUT_DIR = ".data/security-dataset/snapshots";
const SOURCE_KINDS: SourceKind[] = ["skill", "package"];

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const snapshotId = buildSnapshotId(options);
	const snapshotDir = resolve(options.outDir, snapshotId);
	const inputs = await fetchArtifactInputs(options);
	const rows = normalizeArtifactExport(inputs);
	const manifest = buildManifest({ options, snapshotId, rows, inputs });

	if (options.dryRun) {
		console.log(JSON.stringify({ snapshotId, dryRun: true, manifest }, null, 2));
		return;
	}

	await mkdir(snapshotDir, { recursive: true });
	await writeFile(join(snapshotDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	await writeJsonl(join(snapshotDir, "artifacts.jsonl"), rows.artifacts);
	await writeJsonl(join(snapshotDir, "scan_results.jsonl"), rows.scanResults);
	await writeJsonl(join(snapshotDir, "static_findings.jsonl"), rows.staticFindings);
	await writeJsonl(join(snapshotDir, "labels.jsonl"), rows.labels);
	await writeJsonl(join(snapshotDir, "splits.jsonl"), rows.splits);

	console.log(JSON.stringify({ snapshotId, snapshotDir, manifest }, null, 2));
}

async function fetchArtifactInputs(options: Options) {
	const sourceKinds = options.sourceKind === "all" ? SOURCE_KINDS : [options.sourceKind];
	const inputs: ArtifactExportInput[] = [];

	for (const sourceKind of sourceKinds) {
		let cursor: string | null = null;
		while (true) {
			const remaining = options.limit === null ? options.pageSize : options.limit - inputs.length;
			if (remaining <= 0) return inputs;
			const pageSize = Math.min(options.pageSize, remaining);
			const page = runConvexPage(options, sourceKind, cursor, pageSize);
			inputs.push(...page.page);
			if (page.isDone) break;
			cursor = page.continueCursor;
		}
	}

	return inputs;
}

function runConvexPage(
	options: Options,
	sourceKind: SourceKind,
	cursor: string | null,
	numItems: number,
): ConvexPage {
	const args = {
		sourceKind,
		mode: options.mode,
		paginationOpts: { cursor, numItems },
	};
	const commandArgs = ["convex", "run"];
	if (options.prod) commandArgs.push("--prod");
	if (options.deployment) commandArgs.push("--deployment", options.deployment);
	if (options.push) commandArgs.push("--push", "--typecheck=disable");
	commandArgs.push("securityDataset:listArtifactExportPageInternal", JSON.stringify(args));

	const result = spawnSync("bunx", commandArgs, {
		cwd: process.cwd(),
		encoding: "utf8",
		env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
	});
	if (result.status !== 0) {
		process.stderr.write(result.stderr || result.stdout);
		process.exit(result.status ?? 1);
	}
	return parseConvexJson(result.stdout) as ConvexPage;
}

function parseConvexJson(output: string) {
	const lines = output.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const trimmed = lines[index]?.trimStart() ?? "";
		if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
		try {
			return JSON.parse(lines.slice(index).join("\n"));
		} catch {
			continue;
		}
	}
	throw new Error(`Unable to parse Convex JSON output:\n${output}`);
}

function buildManifest(input: {
	options: Options;
	snapshotId: string;
	rows: NormalizedDatasetRows;
	inputs: ArtifactExportInput[];
}) {
	const { options, snapshotId, rows, inputs } = input;
	return {
		snapshot_id: snapshotId,
		created_at: new Date().toISOString(),
		repo_git_sha: gitSha(),
		convex_deployment: options.deployment ?? (options.prod ? "prod" : "configured-dev"),
		export_mode: options.mode,
		row_counts: {
			source_artifacts: inputs.length,
			artifacts: rows.artifacts.length,
			scan_results: rows.scanResults.length,
			static_findings: rows.staticFindings.length,
			labels: rows.labels.length,
			splits: rows.splits.length,
		},
		scanner_versions: Array.from(
			new Set(
				rows.scanResults.flatMap((row) => (row.scanner_version ? [row.scanner_version] : [])),
			),
		).sort(),
		model_names: Array.from(
			new Set(rows.scanResults.flatMap((row) => (row.model ? [row.model] : []))),
		).sort(),
		redaction_policy_version: "public-signals-v1",
		source_tables: ["skillVersions", "packageReleases"],
	};
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

async function writeJsonl(path: string, rows: unknown[]) {
	await writeFile(
		path,
		rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "",
	);
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
		outDir: DEFAULT_OUT_DIR,
		sourceKind: "all",
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
		} else if (arg === "--out-dir") {
			options.outDir = readValue(args, ++index, arg);
		} else if (arg === "--source-kind") {
			options.sourceKind = readSourceKind(readValue(args, ++index, arg));
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
