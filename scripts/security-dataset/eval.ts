import type { ArtifactRow, DatasetLabel, LabelRow, ScanResultRow, ScannerName } from "./normalize";

export type EvalRows = {
	artifacts: ArtifactRow[];
	scanResults: ScanResultRow[];
	labels: LabelRow[];
};

export type EvalOptions = {
	targetLabelSource: LabelRow["label_source"];
};

export type ScannerDisagreementRow = {
	artifact_id: string;
	target_label: DatasetLabel;
	scanner_labels: Partial<Record<ScannerName, DatasetLabel>>;
	distinct_labels: DatasetLabel[];
};

export type ClassifierErrorRow = {
	artifact_id: string;
	scanner: ScannerName;
	scanner_label: DatasetLabel;
	target_label: DatasetLabel;
};

export type EvalMetrics = {
	artifact_count: number;
	scan_result_count: number;
	label_count: number;
	target_label_source: LabelRow["label_source"];
	target_label_distribution: Record<DatasetLabel, number>;
	scanner_coverage: Partial<Record<ScannerName, number>>;
	scanner_metrics: Partial<
		Record<
			ScannerName,
			{
				evaluated: number;
				true_positives: number;
				true_negatives: number;
				false_positives: number;
				false_negatives: number;
				precision: number | null;
				recall: number | null;
				f1: number | null;
			}
		>
	>;
	disagreement_count: number;
};

export type EvalResult = {
	metrics: EvalMetrics;
	falsePositives: ClassifierErrorRow[];
	falseNegatives: ClassifierErrorRow[];
	scannerDisagreements: ScannerDisagreementRow[];
	labels: LabelRow[];
	scanResults: ScanResultRow[];
	diff: EvalDiff;
};

export type EvalDiff = {
	baseline_present: boolean;
	artifact_count_delta: number | null;
	scan_result_count_delta: number | null;
	label_count_delta: number | null;
	target_label_distribution_delta: Record<DatasetLabel, number> | null;
};

const LABELS: DatasetLabel[] = ["clean", "suspicious", "malicious", "unknown"];
const SCANNERS: ScannerName[] = ["static", "virustotal", "llm", "moderation_consensus"];

export function evaluateSnapshotRows(
	rows: EvalRows,
	options: EvalOptions,
	baseline?: EvalMetrics,
): EvalResult {
	const labelsByArtifact = groupByArtifact(rows.labels);
	const scanResultsByArtifact = groupByArtifact(rows.scanResults);
	const targetLabels = new Map<string, DatasetLabel>();
	const targetRows: LabelRow[] = [];

	for (const artifact of rows.artifacts) {
		const target = chooseTargetLabel(labelsByArtifact.get(artifact.artifact_id) ?? [], options);
		if (!target) continue;
		targetLabels.set(artifact.artifact_id, target.label);
		targetRows.push(target);
	}

	const scannerCoverage: Partial<Record<ScannerName, number>> = {};
	const scannerConfusion = new Map<ScannerName, Confusion>();
	const falsePositives: ClassifierErrorRow[] = [];
	const falseNegatives: ClassifierErrorRow[] = [];
	const scannerDisagreements: ScannerDisagreementRow[] = [];

	for (const artifact of rows.artifacts) {
		const artifactId = artifact.artifact_id;
		const targetLabel = targetLabels.get(artifactId) ?? "unknown";
		const scannerLabels = scannerLabelsFor(scanResultsByArtifact.get(artifactId) ?? []);
		const distinctLabels = uniqueLabels(Object.values(scannerLabels));
		if (distinctLabels.length > 1) {
			scannerDisagreements.push({
				artifact_id: artifactId,
				target_label: targetLabel,
				scanner_labels: scannerLabels,
				distinct_labels: distinctLabels,
			});
		}

		for (const scanner of SCANNERS) {
			const scannerLabel = scannerLabels[scanner];
			if (!scannerLabel) continue;
			scannerCoverage[scanner] = (scannerCoverage[scanner] ?? 0) + 1;
			if (targetLabel === "unknown") continue;
			const confusion = getConfusion(scannerConfusion, scanner);
			const scannerRisk = isRiskLabel(scannerLabel);
			const targetRisk = isRiskLabel(targetLabel);
			if (scannerRisk && targetRisk) confusion.truePositives += 1;
			else if (!scannerRisk && !targetRisk) confusion.trueNegatives += 1;
			else if (scannerRisk) {
				confusion.falsePositives += 1;
				falsePositives.push({
					artifact_id: artifactId,
					scanner,
					scanner_label: scannerLabel,
					target_label: targetLabel,
				});
			} else {
				confusion.falseNegatives += 1;
				falseNegatives.push({
					artifact_id: artifactId,
					scanner,
					scanner_label: scannerLabel,
					target_label: targetLabel,
				});
			}
		}
	}

	const metrics: EvalMetrics = {
		artifact_count: rows.artifacts.length,
		scan_result_count: rows.scanResults.length,
		label_count: rows.labels.length,
		target_label_source: options.targetLabelSource,
		target_label_distribution: countLabels(targetRows.map((row) => row.label)),
		scanner_coverage: scannerCoverage,
		scanner_metrics: Object.fromEntries(
			Array.from(scannerConfusion.entries()).map(([scanner, confusion]) => [
				scanner,
				confusionToMetrics(confusion),
			]),
		),
		disagreement_count: scannerDisagreements.length,
	};

	return {
		metrics,
		falsePositives,
		falseNegatives,
		scannerDisagreements,
		labels: targetRows,
		scanResults: rows.scanResults,
		diff: diffMetrics(metrics, baseline),
	};
}

function chooseTargetLabel(labels: LabelRow[], options: EvalOptions) {
	return (
		labels.find((label) => label.label_source === options.targetLabelSource) ??
		labels.find((label) => label.label_source === "moderation_consensus") ??
		labels[0] ??
		null
	);
}

function scannerLabelsFor(scanResults: ScanResultRow[]) {
	const labels: Partial<Record<ScannerName, DatasetLabel>> = {};
	for (const row of scanResults) {
		labels[row.scanner] = row.raw_status_family;
	}
	return labels;
}

function countLabels(labels: DatasetLabel[]) {
	const counts: Record<DatasetLabel, number> = {
		clean: 0,
		suspicious: 0,
		malicious: 0,
		unknown: 0,
	};
	for (const label of labels) {
		counts[label] += 1;
	}
	return counts;
}

function uniqueLabels(labels: DatasetLabel[]) {
	return LABELS.filter((label) => labels.includes(label));
}

function isRiskLabel(label: DatasetLabel) {
	return label === "suspicious" || label === "malicious";
}

type Confusion = {
	truePositives: number;
	trueNegatives: number;
	falsePositives: number;
	falseNegatives: number;
};

function getConfusion(map: Map<ScannerName, Confusion>, scanner: ScannerName) {
	const current = map.get(scanner);
	if (current) return current;
	const next = { truePositives: 0, trueNegatives: 0, falsePositives: 0, falseNegatives: 0 };
	map.set(scanner, next);
	return next;
}

function confusionToMetrics(confusion: Confusion) {
	const evaluated =
		confusion.truePositives +
		confusion.trueNegatives +
		confusion.falsePositives +
		confusion.falseNegatives;
	const precision = ratio(
		confusion.truePositives,
		confusion.truePositives + confusion.falsePositives,
	);
	const recall = ratio(confusion.truePositives, confusion.truePositives + confusion.falseNegatives);
	return {
		evaluated,
		true_positives: confusion.truePositives,
		true_negatives: confusion.trueNegatives,
		false_positives: confusion.falsePositives,
		false_negatives: confusion.falseNegatives,
		precision,
		recall,
		f1:
			precision === null || recall === null
				? null
				: ratio(2 * precision * recall, precision + recall),
	};
}

function ratio(numerator: number, denominator: number) {
	if (denominator === 0) return null;
	return Number((numerator / denominator).toFixed(4));
}

function diffMetrics(metrics: EvalMetrics, baseline?: EvalMetrics): EvalDiff {
	if (!baseline) {
		return {
			baseline_present: false,
			artifact_count_delta: null,
			scan_result_count_delta: null,
			label_count_delta: null,
			target_label_distribution_delta: null,
		};
	}
	return {
		baseline_present: true,
		artifact_count_delta: metrics.artifact_count - baseline.artifact_count,
		scan_result_count_delta: metrics.scan_result_count - baseline.scan_result_count,
		label_count_delta: metrics.label_count - baseline.label_count,
		target_label_distribution_delta: Object.fromEntries(
			LABELS.map((label) => [
				label,
				metrics.target_label_distribution[label] - baseline.target_label_distribution[label],
			]),
		) as Record<DatasetLabel, number>,
	};
}

function groupByArtifact<T extends { artifact_id: string }>(rows: T[]) {
	const map = new Map<string, T[]>();
	for (const row of rows) {
		const current = map.get(row.artifact_id) ?? [];
		current.push(row);
		map.set(row.artifact_id, current);
	}
	return map;
}
