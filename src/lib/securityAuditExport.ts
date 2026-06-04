import { strToU8, zipSync } from "fflate";
import type {
  LlmAnalysis,
  SkillSpectorAnalysis,
  VtAnalysis,
} from "../components/SkillSecurityScanResults";

type SecurityAuditExportEntity = {
  kind: "skill" | "plugin";
  title: string;
  name: string;
  version?: string | null;
  detailPath: string;
};

type StaticScanFinding = {
  code: string;
  severity: string;
  file: string;
  line: number;
  message: string;
  evidence: string;
};

export type StaticScan = {
  status: string;
  reasonCodes: string[];
  findings: StaticScanFinding[];
  summary: string;
  engineVersion: string;
  checkedAt: number;
};

type SecurityAuditExportInput = {
  entity: SecurityAuditExportEntity;
  sha256hash?: string | null;
  vtAnalysis?: VtAnalysis | null;
  llmAnalysis?: LlmAnalysis | null;
  skillSpectorAnalysis?: SkillSpectorAnalysis | null;
  staticScan?: StaticScan | null;
  exportedAt?: string;
};

type SecurityAuditExportEntry = {
  path: string;
  value: unknown;
};

const EXPORT_README = `# ClawHub Security Audit Export

This archive contains stored scanner outcomes for one ClawHub artifact version.

- manifest.json: artifact metadata for the export
- clawscan.json: ClawScan risk review and final audit verdict material
- skillspector.json: SkillSpector agentic-risk findings
- static-analysis.json: deterministic static scan context
- virustotal.json: VirusTotal engine telemetry
`;

function sanitizeFilenameSegment(value: string) {
  return (
    value
      .trim()
      .replace(/^@/, "")
      .replace(/[/\\:]+/g, "-")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "artifact"
  );
}

export function buildSecurityAuditExportFilename(input: SecurityAuditExportInput) {
  const name = sanitizeFilenameSegment(input.entity.name);
  const version = sanitizeFilenameSegment(input.entity.version ?? "latest");
  return `${name}-${version}-security-audit.zip`;
}

function toPrettyJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function buildSecurityAuditExportEntries(input: SecurityAuditExportInput) {
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  const entries: SecurityAuditExportEntry[] = [
    {
      path: "manifest.json",
      value: {
        exportedAt,
        artifact: {
          kind: input.entity.kind,
          title: input.entity.title,
          name: input.entity.name,
          version: input.entity.version ?? null,
          detailPath: input.entity.detailPath,
          sha256hash: input.sha256hash ?? null,
        },
        scanners: {
          clawscan: input.llmAnalysis?.status ?? null,
          skillspector: input.skillSpectorAnalysis?.status ?? null,
          staticAnalysis: input.staticScan?.status ?? null,
          virustotal: input.vtAnalysis?.status ?? null,
        },
      },
    },
    { path: "clawscan.json", value: input.llmAnalysis ?? null },
    { path: "skillspector.json", value: input.skillSpectorAnalysis ?? null },
    { path: "static-analysis.json", value: input.staticScan ?? null },
    { path: "virustotal.json", value: input.vtAnalysis ?? null },
  ];

  return entries;
}

export function buildSecurityAuditExportZip(input: SecurityAuditExportInput) {
  const zipEntries: Record<string, Uint8Array> = {
    "README.md": strToU8(EXPORT_README),
  };

  for (const entry of buildSecurityAuditExportEntries(input)) {
    zipEntries[entry.path] = strToU8(toPrettyJson(entry.value));
  }

  return Uint8Array.from(zipSync(zipEntries, { level: 6 }));
}
