import { useState } from "react";
import {
  getScanStatusInfo,
  type LlmAnalysis,
  type StaticFinding,
  type VtAnalysis,
} from "./SkillSecurityScanResults";
import { Badge, type BadgeProps } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

type RescanRequest = {
  _id: string;
  targetKind: "skill" | "plugin";
  targetVersion: string;
  status: "in_progress" | "completed" | "failed";
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

type DetailRescanState = {
  maxRequests: number;
  requestCount: number;
  remainingRequests: number;
  canRequest: boolean;
  inProgressRequest: RescanRequest | null;
  latestRequest: RescanRequest | null;
};

type DetailSecuritySummaryProps = {
  scannerBasePath: string;
  sha256hash?: string | null;
  vtAnalysis?: VtAnalysis | null;
  llmAnalysis?: LlmAnalysis | null;
  staticScan?: {
    status: string;
    reasonCodes: string[];
    findings: StaticFinding[];
    summary: string;
    engineVersion: string;
    checkedAt: number;
  } | null;
  suppressScanResults?: boolean;
  suppressedMessage?: string | null;
  rescanState?: DetailRescanState | null;
  onRequestRescan?: (() => Promise<void>) | null;
};

function statusFromStaticScan(staticScan: DetailSecuritySummaryProps["staticScan"]) {
  if (staticScan?.status) return staticScan.status;
  return "pending";
}

function badgeVariantForScanStatus(status: string): BadgeProps["variant"] {
  const normalized = status.toLowerCase();
  if (normalized === "clean" || normalized === "benign") return "success";
  if (normalized === "cleared") return "success";
  if (normalized === "suspicious") return "warning";
  if (normalized === "malicious" || normalized === "error") return "destructive";
  if (normalized === "pending" || normalized === "queued" || normalized === "loading") {
    return "pending";
  }
  return "compact";
}

function ScannerRow({ href, label, status }: { href: string; label: string; status: string }) {
  const info = getScanStatusInfo(status);
  return (
    <a
      href={href}
      className="flex min-w-0 items-center justify-between gap-3 rounded-[var(--radius-sm)] px-1 py-2 text-sm !no-underline hover:bg-[color:var(--surface-muted)] hover:!no-underline"
    >
      <span className="flex min-w-0 items-center gap-2 font-semibold text-[color:var(--ink)]">
        <span className="truncate">{label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Badge variant={badgeVariantForScanStatus(status)}>{info.label}</Badge>
      </span>
    </a>
  );
}

function rescanDisabledReason(state: DetailRescanState | null | undefined) {
  if (!state) return null;
  if (state.inProgressRequest) return "A rescan is already in progress.";
  if (state.remainingRequests <= 0) {
    return `Rescan limit reached (${state.requestCount}/${state.maxRequests}).`;
  }
  if (!state.canRequest) return "This release is not eligible for another rescan.";
  return null;
}

export function DetailSecuritySummary({
  scannerBasePath,
  vtAnalysis,
  llmAnalysis,
  staticScan,
  suppressScanResults = false,
  suppressedMessage,
  rescanState,
  onRequestRescan,
}: DetailSecuritySummaryProps) {
  const [isRequestingRescan, setIsRequestingRescan] = useState(false);
  const vtStatus = suppressScanResults
    ? "cleared"
    : (vtAnalysis?.verdict ?? vtAnalysis?.status ?? "pending");
  const llmStatus = suppressScanResults
    ? "cleared"
    : (llmAnalysis?.verdict ?? llmAnalysis?.status ?? "pending");
  const staticStatus = suppressScanResults ? "cleared" : statusFromStaticScan(staticScan);
  const rescanButtonDisabledReason = rescanDisabledReason(rescanState);
  const isScanInProgress = Boolean(rescanState?.inProgressRequest);
  const rescanButtonLabel = isScanInProgress
    ? "Scanning"
    : isRequestingRescan
      ? "Requesting..."
      : "Rescan";

  async function handleRequestRescan() {
    if (!onRequestRescan || rescanButtonDisabledReason || isRequestingRescan) return;
    setIsRequestingRescan(true);
    try {
      await onRequestRescan();
    } finally {
      setIsRequestingRescan(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          Security Scans
          {rescanState && onRequestRescan ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-center sm:ml-auto sm:w-auto"
              loading={isRequestingRescan || isScanInProgress}
              disabled={Boolean(rescanButtonDisabledReason)}
              title={rescanButtonDisabledReason ?? "Request a fresh scan"}
              onClick={() => void handleRequestRescan()}
            >
              {rescanButtonLabel}
            </Button>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {suppressScanResults && suppressedMessage ? (
            <p className="m-0 text-sm text-[color:var(--ink-soft)]">{suppressedMessage}</p>
          ) : null}
          <ScannerRow href={`${scannerBasePath}/virustotal`} label="VirusTotal" status={vtStatus} />
          <ScannerRow href={`${scannerBasePath}/openclaw`} label="ClawScan" status={llmStatus} />
          <ScannerRow
            href={`${scannerBasePath}/static-analysis`}
            label="Static analysis"
            status={staticStatus}
          />
        </div>
      </CardContent>
    </Card>
  );
}
