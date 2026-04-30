import { createHash } from "node:crypto";

export type SourceKind = "skill" | "package";
export type DatasetLabel = "clean" | "suspicious" | "malicious" | "unknown";
export type DatasetSplit = "train" | "validation" | "test" | "eval_holdout";
export type ScannerName = "static" | "virustotal" | "llm" | "moderation_consensus";

export type ExportFileInput = {
	path: string;
	size: number;
	sha256: string;
	contentType: string | null;
};

export type VtAnalysisInput = {
	status: string;
	verdict: string | null;
	analysis: string | null;
	source: string | null;
	scanner: string | null;
	engineStats: {
		malicious?: number;
		suspicious?: number;
		undetected?: number;
		harmless?: number;
	} | null;
	checkedAt: number;
};

export type StaticScanInput = {
	status: DatasetLabel;
	reasonCodes: string[];
	findings: Array<{
		code: string;
		severity: "info" | "warn" | "critical";
		file: string;
		line: number;
		message: string;
		evidence: string;
	}>;
	summary: string;
	engineVersion: string;
	checkedAt: number;
};

export type LlmAnalysisInput = {
	status: string;
	verdict: string | null;
	confidence: string | null;
	summary: string | null;
	dimensions: Array<{
		name: string;
		label: string;
		rating: string;
		detail: string;
	}> | null;
	guidance: string | null;
	findings: string | null;
	model: string | null;
	checkedAt: number;
};

export type ModerationConsensusInput = {
	verdict: DatasetLabel | null;
	reasonCodes: string[];
	summary: string | null;
	engineVersion: string | null;
	evaluatedAt: number | null;
};

export type ArtifactExportInput = {
	sourceKind: SourceKind;
	sourceDocId: string;
	parentDocId: string;
	publicName: string;
	publicSlug: string | null;
	version: string;
	artifactSha256: string | null;
	createdAt: number;
	softDeletedAt: number | null;
	files: ExportFileInput[];
	capabilityTags: string[];
	packageFamily: string | null;
	packageChannel: string | null;
	packageExecutesCode: boolean | null;
	sourceRepoHost: string | null;
	vtAnalysis: VtAnalysisInput | null;
	staticScan: StaticScanInput | null;
	llmAnalysis: LlmAnalysisInput | null;
	moderationConsensus: ModerationConsensusInput | null;
};

export type ArtifactRow = {
	artifact_id: string;
	source_kind: SourceKind;
	source_table: "skillVersions" | "packageReleases";
	source_doc_id_hash: string;
	parent_doc_id_hash: string;
	public_name: string;
	public_slug: string | null;
	version: string;
	artifact_sha256: string | null;
	created_at: number;
	created_month: string;
	soft_deleted: boolean;
	is_public: boolean;
	file_count: number;
	total_bytes: number;
	file_ext_counts: Record<string, number>;
	capability_tags: string[];
	package_family: string | null;
	package_channel: string | null;
	package_executes_code: boolean | null;
	source_repo_host: string | null;
	has_vt_scan: boolean;
	has_static_scan: boolean;
	has_llm_scan: boolean;
};

export type ScanResultRow = {
	artifact_id: string;
	scanner: ScannerName;
	scanner_version: string | null;
	model: string | null;
	status: string;
	verdict: string | null;
	confidence: string | null;
	checked_at: number | null;
	reason_codes: string[];
	engine_stats: VtAnalysisInput["engineStats"];
	summary_redacted: string | null;
	raw_status_family: DatasetLabel;
};

export type StaticFindingRow = {
	artifact_id: string;
	finding_id: string;
	code: string;
	severity: "info" | "warn" | "critical";
	file_path_hash: string;
	file_ext: string;
	line_bucket: string;
	message: string;
	evidence_redacted: string;
};

export type LabelRow = {
	artifact_id: string;
	label: DatasetLabel;
	label_source: "static_scan" | "virustotal" | "llm_scan" | "moderation_consensus";
	label_confidence: string;
	reason_codes: string[];
	scanner_agreement: number;
	notes_redacted: string | null;
};

export type SplitRow = {
	artifact_id: string;
	split: DatasetSplit;
	split_version: string;
	split_key: string;
};

export type NormalizedDatasetRows = {
	artifacts: ArtifactRow[];
	scanResults: ScanResultRow[];
	staticFindings: StaticFindingRow[];
	labels: LabelRow[];
	splits: SplitRow[];
};

const SPLIT_VERSION = "sha256-v1";
const MAX_REDACTED_TEXT_LENGTH = 240;

const SECRET_PATTERNS: RegExp[] = [
	/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
	/\bsk-[A-Za-z0-9_-]{20,}\b/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"',\s]{8,}/gi,
];

export function hashString(value: string) {
	return createHash("sha256").update(value).digest("hex");
}

export function redactText(value: string | null | undefined, maxLength = MAX_REDACTED_TEXT_LENGTH) {
	if (!value) return null;
	let redacted = "";
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		redacted += code < 32 || code === 127 ? " " : value.charAt(index);
	}
	for (const pattern of SECRET_PATTERNS) {
		redacted = redacted.replace(pattern, "[REDACTED_SECRET]");
	}
	redacted = redacted.replace(/\s+/g, " ").trim();
	if (redacted.length <= maxLength) return redacted;
	return `${redacted.slice(0, maxLength - 1)}...`;
}

export function normalizeArtifactExport(inputs: ArtifactExportInput[]): NormalizedDatasetRows {
	const artifacts: ArtifactRow[] = [];
	const scanResults: ScanResultRow[] = [];
	const staticFindings: StaticFindingRow[] = [];
	const labels: LabelRow[] = [];
	const splits: SplitRow[] = [];

	for (const input of inputs) {
		const artifactId = buildArtifactId(input);
		const artifact = buildArtifactRow(input, artifactId);
		artifacts.push(artifact);
		scanResults.push(...buildScanResultRows(input, artifactId));
		staticFindings.push(...buildStaticFindingRows(input, artifactId));
		labels.push(...buildLabelRows(input, artifactId));
		splits.push(buildSplitRow(input, artifactId));
	}

	return { artifacts, scanResults, staticFindings, labels, splits };
}

export function buildArtifactId(input: ArtifactExportInput) {
	const hash = input.artifactSha256?.trim();
	if (hash) return `${input.sourceKind}:${hash}`;
	return `${input.sourceKind}:doc:${hashString(input.sourceDocId).slice(0, 24)}`;
}

export function assignSplit(splitKey: string): DatasetSplit {
	const digest = hashString(splitKey);
	const bucket = Number.parseInt(digest.slice(0, 8), 16) / 0xffffffff;
	if (bucket < 0.7) return "train";
	if (bucket < 0.85) return "validation";
	if (bucket < 0.95) return "test";
	return "eval_holdout";
}

function buildArtifactRow(input: ArtifactExportInput, artifactId: string): ArtifactRow {
	return {
		artifact_id: artifactId,
		source_kind: input.sourceKind,
		source_table: input.sourceKind === "skill" ? "skillVersions" : "packageReleases",
		source_doc_id_hash: hashString(input.sourceDocId),
		parent_doc_id_hash: hashString(input.parentDocId),
		public_name: input.publicName,
		public_slug: input.publicSlug,
		version: input.version,
		artifact_sha256: input.artifactSha256,
		created_at: input.createdAt,
		created_month: createdMonth(input.createdAt),
		soft_deleted: input.softDeletedAt !== null,
		is_public: input.softDeletedAt === null,
		file_count: input.files.length,
		total_bytes: input.files.reduce((sum, file) => sum + file.size, 0),
		file_ext_counts: countFileExtensions(input.files),
		capability_tags: [...input.capabilityTags].sort((a, b) => a.localeCompare(b)),
		package_family: input.packageFamily,
		package_channel: input.packageChannel,
		package_executes_code: input.packageExecutesCode,
		source_repo_host: input.sourceRepoHost,
		has_vt_scan: input.vtAnalysis !== null,
		has_static_scan: input.staticScan !== null,
		has_llm_scan: input.llmAnalysis !== null,
	};
}

function buildScanResultRows(input: ArtifactExportInput, artifactId: string): ScanResultRow[] {
	const rows: ScanResultRow[] = [];
	if (input.staticScan) {
		rows.push({
			artifact_id: artifactId,
			scanner: "static",
			scanner_version: input.staticScan.engineVersion,
			model: null,
			status: input.staticScan.status,
			verdict: input.staticScan.status,
			confidence: null,
			checked_at: input.staticScan.checkedAt,
			reason_codes: [...input.staticScan.reasonCodes].sort((a, b) => a.localeCompare(b)),
			engine_stats: null,
			summary_redacted: redactText(input.staticScan.summary),
			raw_status_family: normalizeLabel(input.staticScan.status),
		});
	}
	if (input.vtAnalysis) {
		const label = labelFromVirusTotal(input.vtAnalysis);
		rows.push({
			artifact_id: artifactId,
			scanner: "virustotal",
			scanner_version: input.vtAnalysis.scanner,
			model: null,
			status: input.vtAnalysis.status,
			verdict: input.vtAnalysis.verdict,
			confidence: null,
			checked_at: input.vtAnalysis.checkedAt,
			reason_codes: [],
			engine_stats: input.vtAnalysis.engineStats,
			summary_redacted: redactText(input.vtAnalysis.analysis),
			raw_status_family: label,
		});
	}
	if (input.llmAnalysis) {
		const label = labelFromText(input.llmAnalysis.verdict ?? input.llmAnalysis.status);
		rows.push({
			artifact_id: artifactId,
			scanner: "llm",
			scanner_version: null,
			model: input.llmAnalysis.model,
			status: input.llmAnalysis.status,
			verdict: input.llmAnalysis.verdict,
			confidence: input.llmAnalysis.confidence,
			checked_at: input.llmAnalysis.checkedAt,
			reason_codes: [],
			engine_stats: null,
			summary_redacted: redactText(input.llmAnalysis.summary ?? input.llmAnalysis.findings),
			raw_status_family: label,
		});
	}
	if (input.moderationConsensus?.verdict) {
		rows.push({
			artifact_id: artifactId,
			scanner: "moderation_consensus",
			scanner_version: input.moderationConsensus.engineVersion,
			model: null,
			status: input.moderationConsensus.verdict,
			verdict: input.moderationConsensus.verdict,
			confidence: "consensus",
			checked_at: input.moderationConsensus.evaluatedAt,
			reason_codes: [...input.moderationConsensus.reasonCodes].sort((a, b) => a.localeCompare(b)),
			engine_stats: null,
			summary_redacted: redactText(input.moderationConsensus.summary),
			raw_status_family: input.moderationConsensus.verdict,
		});
	}
	return rows;
}

function buildStaticFindingRows(
	input: ArtifactExportInput,
	artifactId: string,
): StaticFindingRow[] {
	return (input.staticScan?.findings ?? []).map((finding, index) => ({
		artifact_id: artifactId,
		finding_id: `${artifactId}:static:${index}:${hashString(
			`${finding.code}:${finding.file}:${finding.line}:${finding.message}`,
		).slice(0, 12)}`,
		code: finding.code,
		severity: finding.severity,
		file_path_hash: hashString(finding.file),
		file_ext: fileExtension(finding.file),
		line_bucket: lineBucket(finding.line),
		message: finding.message,
		evidence_redacted: redactText(finding.evidence) ?? "",
	}));
}

function buildLabelRows(input: ArtifactExportInput, artifactId: string): LabelRow[] {
	const scannerLabels: DatasetLabel[] = [];
	const rows: LabelRow[] = [];
	if (input.staticScan) {
		const label = normalizeLabel(input.staticScan.status);
		scannerLabels.push(label);
		rows.push({
			artifact_id: artifactId,
			label,
			label_source: "static_scan",
			label_confidence: "scanner",
			reason_codes: [...input.staticScan.reasonCodes].sort((a, b) => a.localeCompare(b)),
			scanner_agreement: 0,
			notes_redacted: redactText(input.staticScan.summary),
		});
	}
	if (input.vtAnalysis) {
		const label = labelFromVirusTotal(input.vtAnalysis);
		scannerLabels.push(label);
		rows.push({
			artifact_id: artifactId,
			label,
			label_source: "virustotal",
			label_confidence: "scanner",
			reason_codes: [],
			scanner_agreement: 0,
			notes_redacted: redactText(input.vtAnalysis.analysis),
		});
	}
	if (input.llmAnalysis) {
		const label = labelFromText(input.llmAnalysis.verdict ?? input.llmAnalysis.status);
		scannerLabels.push(label);
		rows.push({
			artifact_id: artifactId,
			label,
			label_source: "llm_scan",
			label_confidence: input.llmAnalysis.confidence ?? "scanner",
			reason_codes: [],
			scanner_agreement: 0,
			notes_redacted: redactText(input.llmAnalysis.summary ?? input.llmAnalysis.findings),
		});
	}
	if (input.moderationConsensus?.verdict) {
		rows.push({
			artifact_id: artifactId,
			label: input.moderationConsensus.verdict,
			label_source: "moderation_consensus",
			label_confidence: "consensus",
			reason_codes: [...input.moderationConsensus.reasonCodes].sort((a, b) => a.localeCompare(b)),
			scanner_agreement: countAgreement(scannerLabels, input.moderationConsensus.verdict),
			notes_redacted: redactText(input.moderationConsensus.summary),
		});
	}

	const consensus = consensusLabel(scannerLabels);
	if (!input.moderationConsensus?.verdict && consensus !== "unknown") {
		rows.push({
			artifact_id: artifactId,
			label: consensus,
			label_source: "moderation_consensus",
			label_confidence: "derived_consensus",
			reason_codes: input.staticScan?.reasonCodes ?? [],
			scanner_agreement: countAgreement(scannerLabels, consensus),
			notes_redacted: null,
		});
	}

	return rows.map((row) => ({
		...row,
		scanner_agreement:
			row.scanner_agreement > 0 ? row.scanner_agreement : countAgreement(scannerLabels, row.label),
	}));
}

function buildSplitRow(input: ArtifactExportInput, artifactId: string): SplitRow {
	const splitKey = input.artifactSha256 ?? `${input.sourceKind}:${input.sourceDocId}`;
	return {
		artifact_id: artifactId,
		split: assignSplit(splitKey),
		split_version: SPLIT_VERSION,
		split_key: hashString(splitKey),
	};
}

function consensusLabel(labels: DatasetLabel[]): DatasetLabel {
	if (labels.length === 0) return "unknown";
	if (labels.includes("malicious")) return "malicious";
	if (labels.includes("suspicious")) return "suspicious";
	if (labels.every((label) => label === "clean")) return "clean";
	return "unknown";
}

function countAgreement(labels: DatasetLabel[], label: DatasetLabel) {
	return labels.filter((candidate) => candidate === label).length;
}

function labelFromVirusTotal(analysis: VtAnalysisInput): DatasetLabel {
	if ((analysis.engineStats?.malicious ?? 0) > 0) return "malicious";
	if ((analysis.engineStats?.suspicious ?? 0) > 0) return "suspicious";
	return labelFromText(analysis.verdict ?? analysis.status);
}

function labelFromText(value: string | null | undefined): DatasetLabel {
	const normalized = value?.toLowerCase() ?? "";
	if (normalized.includes("malicious") || normalized.includes("malware")) return "malicious";
	if (normalized.includes("suspicious")) return "suspicious";
	if (
		normalized.includes("clean") ||
		normalized.includes("safe") ||
		normalized.includes("harmless")
	) {
		return "clean";
	}
	return "unknown";
}

function normalizeLabel(value: string): DatasetLabel {
	if (value === "clean" || value === "suspicious" || value === "malicious") return value;
	return labelFromText(value);
}

function countFileExtensions(files: ExportFileInput[]) {
	const counts: Record<string, number> = {};
	for (const file of files) {
		const ext = fileExtension(file.path);
		counts[ext] = (counts[ext] ?? 0) + 1;
	}
	return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function fileExtension(path: string) {
	const fileName = path.split("/").at(-1) ?? path;
	const dotIndex = fileName.lastIndexOf(".");
	if (dotIndex <= 0 || dotIndex === fileName.length - 1) return "";
	return fileName.slice(dotIndex).toLowerCase();
}

function lineBucket(line: number) {
	if (line <= 20) return "1-20";
	if (line <= 50) return "21-50";
	if (line <= 100) return "51-100";
	if (line <= 250) return "101-250";
	return "251+";
}

function createdMonth(timestamp: number) {
	return new Date(timestamp).toISOString().slice(0, 7);
}
