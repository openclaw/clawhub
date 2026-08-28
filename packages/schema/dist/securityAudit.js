export function getSecurityAuditOverviewCopy({ llmAnalysis, }) {
    return [
        llmAnalysis?.summary?.trim() || "No security analysis has been recorded yet.",
        llmAnalysis?.guidance?.trim() || null,
    ].filter((copy) => Boolean(copy));
}
export function formatSecurityAuditOverview(input) {
    return getSecurityAuditOverviewCopy(input).join("\n\n");
}
//# sourceMappingURL=securityAudit.js.map