type SecurityAuditOverviewInput = {
  llmAnalysis?: {
    summary?: string | null;
    guidance?: string | null;
  } | null;
};

export function getSecurityAuditOverviewCopy({
  llmAnalysis,
}: SecurityAuditOverviewInput): string[] {
  return [
    llmAnalysis?.summary?.trim() || "No security analysis has been recorded yet.",
    llmAnalysis?.guidance?.trim() || null,
  ].filter((copy): copy is string => Boolean(copy));
}

export function formatSecurityAuditOverview(input: SecurityAuditOverviewInput): string {
  return getSecurityAuditOverviewCopy(input).join("\n\n");
}
