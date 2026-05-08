import { ScanResultBadge } from "../SkillSecurityScanResults";
import {
  artifactStatusToScanStatus,
  type ArtifactDisplayStatus,
  type ArtifactScanSignalStatus,
} from "./artifactStatus";

export type ArtifactRescanState = {
  maxRequests: number;
  requestCount: number;
  remainingRequests: number;
  canRequest: boolean;
  inProgressRequest: unknown | null;
};

export function formatArtifactRescanState(state: ArtifactRescanState | null) {
  if (state?.inProgressRequest) return "Scan running";
  if (!state) return "Rescan available";
  if (state.remainingRequests <= 0)
    return `Limit reached (${state.requestCount}/${state.maxRequests})`;
  return `${state.remainingRequests}/${state.maxRequests} rescans left`;
}

export function ArtifactScanStrip({
  vtStatus,
  llmStatus,
  staticScanStatus,
  rescanState,
}: {
  vtStatus: string | null;
  llmStatus: string | null;
  staticScanStatus: ArtifactScanSignalStatus;
  rescanState: ArtifactRescanState | null;
}) {
  return (
    <div className="dashboard-scan-strip" aria-label="Latest scan signals">
      <ScanSignal label="VT" status={vtStatus} />
      <ScanSignal label="LLM" status={llmStatus} />
      <ScanSignal label="Static" status={staticScanStatus} />
      <span className="dashboard-artifact-rescan">{formatArtifactRescanState(rescanState)}</span>
    </div>
  );
}

export function ScanSignal({ label, status }: { label: string; status: string | null }) {
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
