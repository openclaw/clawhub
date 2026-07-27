export type CanonicalSearchResult = Record<string, unknown> & {
  id: string;
  source: "clawhub" | "skills-sh";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string) {
  if (!isRecord(value)) throw new Error(`canonical search result is missing ${field}`);
  return value;
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`canonical search result is missing ${field}`);
  }
  return value;
}

export function assertCanonicalSearchResults(results: unknown[]): CanonicalSearchResult[] {
  return results.map((value) => {
    const result = requireRecord(value, "result");
    const id = requireString(result.id, "id");
    if (result.source !== "clawhub" && result.source !== "skills-sh") {
      throw new Error(`canonical search result ${id} has invalid source`);
    }
    const canonicalUrl = requireString(result.canonicalUrl, "canonicalUrl");
    const links = requireRecord(result.links, "links");
    if (links.canonical !== canonicalUrl) {
      throw new Error(`canonical search result ${id} has inconsistent canonical links`);
    }
    if (typeof result.official !== "boolean" || typeof result.featured !== "boolean") {
      throw new Error(`canonical search result ${id} is missing official/featured metadata`);
    }
    const install = requireRecord(result.install, "install");
    requireString(install.reference, "install.reference");
    requireRecord(result.sourceIdentity, "sourceIdentity");
    const trust = requireRecord(result.trust, "trust");
    if (trust.visibility !== "public" || trust.installability !== "installable") {
      throw new Error(`canonical search result ${id} is not public and installable`);
    }
    requireRecord(result.metrics, "metrics");
    if (result.source === "clawhub" && !isRecord(result.publisher)) {
      throw new Error(`canonical native search result ${id} is missing publisher metadata`);
    }
    if (result.source === "skills-sh" && result.publisher !== null) {
      throw new Error(`canonical external search result ${id} must not invent a publisher`);
    }
    return result as CanonicalSearchResult;
  });
}

export function orderedResultIds(results: unknown[]) {
  return assertCanonicalSearchResults(results).map((result) => result.id);
}

export function assertStableOrder(orders: string[][]) {
  const expected = JSON.stringify(orders[0] ?? []);
  if (orders.some((order) => JSON.stringify(order) !== expected)) {
    throw new Error("canonical search order drifted across requests or consumer surfaces");
  }
}

function nearestRank(values: number[], percentile: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[index] ?? 0;
}

export function latencySummary(values: number[]) {
  if (values.length === 0) throw new Error("latency sample is empty");
  return {
    medianMs: nearestRank(values, 0.5),
    p95Ms: nearestRank(values, 0.95),
  };
}
