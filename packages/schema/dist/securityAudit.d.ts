type SecurityAuditOverviewInput = {
    llmAnalysis?: {
        summary?: string | null;
        guidance?: string | null;
    } | null;
};
export declare function getSecurityAuditOverviewCopy({ llmAnalysis, }: SecurityAuditOverviewInput): string[];
export declare function formatSecurityAuditOverview(input: SecurityAuditOverviewInput): string;
type AuditRiskFinding = {
    status?: string;
    severity?: string;
    confidence?: string;
    evidence?: unknown;
};
type AuditLlmAnalysis = {
    status?: string | null;
    verdict?: string | null;
    agenticRiskFindings?: AuditRiskFinding[];
};
export declare function isVisibleAgenticRiskFinding(finding: AuditRiskFinding): boolean;
export declare function getClawScanDisplayStatus(analysis?: AuditLlmAnalysis | null): string;
export declare function aggregateAuditVerdict(signals: {
    llmAnalysis?: AuditLlmAnalysis | null;
    staticScan?: {
        status?: string | null;
    } | null;
}): string;
export {};
