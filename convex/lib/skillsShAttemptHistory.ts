type CatalogAttempt = {
  publicationRolledBackAt?: number;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  verdict?: "clean" | "suspicious" | "malicious" | "failed";
};

export function newestReusableAllowedAttempt<T extends CatalogAttempt>(
  matchingAttempts: T[],
): T | null {
  const newest = matchingAttempts[0];
  return newest?.status === "succeeded" &&
    newest.publicationRolledBackAt === undefined &&
    (newest.verdict === "clean" || newest.verdict === "suspicious")
    ? newest
    : null;
}
