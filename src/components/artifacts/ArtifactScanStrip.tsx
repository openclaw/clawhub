import { ScanResultBadge } from "../SkillSecurityScanResults";
import { artifactStatusToScanStatus, type ArtifactDisplayStatus } from "./artifactStatus";

export function ArtifactScanStatusValue({ status }: { status: ArtifactDisplayStatus }) {
  return (
    <span className="dashboard-scan-result-value">
      <ScanResultBadge status={artifactStatusToScanStatus(status)} />
    </span>
  );
}
