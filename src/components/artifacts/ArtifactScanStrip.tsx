import { ScanResultBadge } from "../SkillSecurityScanResults";
import {
  artifactStatusToScanStatus,
  type ArtifactDisplayStatus,
  type ArtifactScanSignalStatus,
} from "./artifactStatus";

export function ArtifactScanStrip({
  vtStatus,
  llmStatus,
  staticScanStatus,
}: {
  vtStatus: string | null;
  llmStatus: string | null;
  staticScanStatus: ArtifactScanSignalStatus;
}) {
  return (
    <div className="dashboard-scan-strip" aria-label="Latest scan signals">
      <ScanSignal label="VT" status={vtStatus} />
      <ScanSignal label="LLM" status={llmStatus} />
      <ScanSignal label="Static" status={staticScanStatus} />
    </div>
  );
}

function ScanSignal({ label, status }: { label: string; status: string | null }) {
  const normalized = status ?? "not-run";
  return (
    <span className="dashboard-scan-signal">
      <span className="dashboard-scan-label">{label}</span>
      <ScanResultBadge status={normalized} />
    </span>
  );
}

export function ArtifactScanResult({ status }: { status: ArtifactDisplayStatus }) {
  return (
    <div className="dashboard-scan-result-kv">
      <span>Scan result</span>
      <ScanResultBadge status={artifactStatusToScanStatus(status)} />
    </div>
  );
}
