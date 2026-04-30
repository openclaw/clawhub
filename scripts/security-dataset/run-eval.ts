import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { evaluateSnapshotRows, type EvalMetrics } from "./eval";
import type { ArtifactRow, LabelRow, ScanResultRow } from "./normalize";

type Options = {
	snapshotDir: string;
	baselineRunDir: string | null;
	targetLabelSource: LabelRow["label_source"];
	runId: string | null;
};

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const snapshotDir = resolve(options.snapshotDir);
	const runId = options.runId ?? buildRunId();
	const runDir = join(snapshotDir, "scan_runs", runId);
	const baseline = options.baselineRunDir
		? await readJson<EvalMetrics>(join(resolve(options.baselineRunDir), "metrics.json"))
		: undefined;
	const rows = {
		artifacts: await readJsonl<ArtifactRow>(join(snapshotDir, "artifacts.jsonl")),
		scanResults: await readJsonl<ScanResultRow>(join(snapshotDir, "scan_results.jsonl")),
		labels: await readJsonl<LabelRow>(join(snapshotDir, "labels.jsonl")),
	};
	const result = evaluateSnapshotRows(
		rows,
		{ targetLabelSource: options.targetLabelSource },
		baseline,
	);

	await mkdir(runDir, { recursive: true });
	await writeJson(join(runDir, "metrics.json"), result.metrics);
	await writeJson(join(runDir, "diff.json"), result.diff);
	await writeJsonl(join(runDir, "false_positives.jsonl"), result.falsePositives);
	await writeJsonl(join(runDir, "false_negatives.jsonl"), result.falseNegatives);
	await writeJsonl(join(runDir, "scanner_disagreements.jsonl"), result.scannerDisagreements);
	await writeJsonl(join(runDir, "labels.jsonl"), result.labels);
	await writeJsonl(join(runDir, "scan_results.jsonl"), result.scanResults);

	console.log(
		JSON.stringify(
			{
				runId,
				runDir,
				snapshot: basename(snapshotDir),
				metrics: result.metrics,
				diff: result.diff,
			},
			null,
			2,
		),
	);
}

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, "utf8")) as T;
}

async function readJsonl<T>(path: string): Promise<T[]> {
	const content = await readFile(path, "utf8");
	return content
		.split(/\r?\n/)
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as T);
}

async function writeJson(path: string, value: unknown) {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonl(path: string, rows: unknown[]) {
	await writeFile(
		path,
		rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "",
	);
}

function buildRunId() {
	return `eval-${new Date()
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}Z$/, "Z")}`;
}

function parseArgs(args: string[]): Options {
	const options: Options = {
		snapshotDir: "",
		baselineRunDir: null,
		targetLabelSource: "moderation_consensus",
		runId: null,
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--snapshot-dir") {
			options.snapshotDir = readValue(args, ++index, arg);
		} else if (arg === "--baseline-run-dir") {
			options.baselineRunDir = readValue(args, ++index, arg);
		} else if (arg === "--target-label-source") {
			options.targetLabelSource = readLabelSource(readValue(args, ++index, arg));
		} else if (arg === "--run-id") {
			options.runId = readValue(args, ++index, arg);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}

	if (!options.snapshotDir) throw new Error("Missing required --snapshot-dir");
	return options;
}

function readValue(args: string[], index: number, flag: string) {
	const value = args[index];
	if (!value) throw new Error(`Missing value for ${flag}`);
	return value;
}

function readLabelSource(value: string): LabelRow["label_source"] {
	if (
		value === "static_scan" ||
		value === "virustotal" ||
		value === "llm_scan" ||
		value === "moderation_consensus"
	) {
		return value;
	}
	throw new Error(`Unsupported label source: ${value}`);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
