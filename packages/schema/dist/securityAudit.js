export function getSecurityAuditOverviewCopy({ llmAnalysis, }) {
    return [
        llmAnalysis?.summary?.trim() || "No security analysis has been recorded yet.",
        llmAnalysis?.guidance?.trim() || null,
    ].filter((copy) => Boolean(copy));
}
export function formatSecurityAuditOverview(input) {
    return getSecurityAuditOverviewCopy(input).join("\n\n");
}
function severityRank(severity) {
    switch (severity?.trim().toLowerCase()) {
        case "critical":
            return 5;
        case "high":
            return 4;
        case "medium":
            return 3;
        case "low":
            return 2;
        case "info":
            return 1;
        default:
            return 0;
    }
}
function isLowConfidence(value) {
    return typeof value === "string" && value.trim().toLowerCase() === "low";
}
export function isVisibleAgenticRiskFinding(finding) {
    return ((finding.status === "note" || finding.status === "concern") &&
        Boolean(finding.evidence) &&
        !isLowConfidence(finding.confidence));
}
function highestVisibleFindingSeverityRank(analysis) {
    let highest = 0;
    for (const finding of (analysis?.agenticRiskFindings ?? []).filter(isVisibleAgenticRiskFinding)) {
        highest = Math.max(highest, severityRank(finding.severity));
    }
    return highest;
}
export function getClawScanDisplayStatus(analysis) {
    const status = (analysis?.verdict ?? analysis?.status)?.trim().toLowerCase();
    if (!status)
        return "pending";
    const highestSeverity = highestVisibleFindingSeverityRank(analysis);
    if (status === "suspicious") {
        return "review";
    }
    if ((status === "clean" || status === "benign") && highestSeverity >= severityRank("medium")) {
        return "review";
    }
    return status;
}
export function aggregateAuditVerdict(signals) {
    const clawScanStatus = getClawScanDisplayStatus(signals.llmAnalysis);
    const staticStatus = signals.staticScan?.status?.trim().toLowerCase();
    if (clawScanStatus === "malicious" || staticStatus === "malicious")
        return "malicious";
    if (clawScanStatus === "review" ||
        clawScanStatus === "suspicious" ||
        clawScanStatus === "warn" ||
        clawScanStatus === "warning" ||
        staticStatus === "suspicious" ||
        staticStatus === "review" ||
        staticStatus === "warn" ||
        staticStatus === "warning") {
        return "review";
    }
    if (clawScanStatus !== "pending")
        return clawScanStatus;
    return staticStatus || clawScanStatus;
}
//# sourceMappingURL=securityAudit.js.map