type SecurityAuditOverviewInput = {
    llmAnalysis?: {
        summary?: string | null;
        guidance?: string | null;
    } | null;
};
export declare function getSecurityAuditOverviewCopy({ llmAnalysis, }: SecurityAuditOverviewInput): string[];
export declare function formatSecurityAuditOverview(input: SecurityAuditOverviewInput): string;
export {};
