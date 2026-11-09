export type PluginApiRetirement = {
  deprecatedApi: string;
  replacement: string;
  removeAfter: string;
};

type RetirementFinding = Partial<PluginApiRetirement> & {
  deprecated?: boolean;
  issueClass?: string;
  findingKind?: string;
  level?: string;
  severity?: string;
};

export function pluginApiRetirement(finding: RetirementFinding): PluginApiRetirement | null {
  if (
    finding.findingKind === "error" ||
    finding.level === "error" ||
    finding.level === "breakage" ||
    finding.severity === "P0" ||
    !(finding.deprecated || finding.issueClass === "deprecation-warning")
  )
    return null;
  const deprecatedApi = finding.deprecatedApi?.trim();
  const replacement = finding.replacement?.trim();
  const removeAfter = finding.removeAfter?.trim();
  if (!deprecatedApi || !replacement || !removeAfter || !/^\d{4}-\d{2}-\d{2}$/.test(removeAfter)) {
    return null;
  }
  const date = new Date(`${removeAfter}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== removeAfter)
    return null;
  // This allowlist is also the public projection: never expose source evidence here.
  return { deprecatedApi, replacement, removeAfter };
}

export function collectPluginApiRetirements(findings: RetirementFinding[]): PluginApiRetirement[] {
  const retirements = new Map<string, PluginApiRetirement>();
  for (const finding of findings) {
    const retirement = pluginApiRetirement(finding);
    if (retirement) retirements.set(JSON.stringify(retirement), retirement);
  }
  return [...retirements.values()].sort(
    (a, b) =>
      a.removeAfter.localeCompare(b.removeAfter) || a.deprecatedApi.localeCompare(b.deprecatedApi),
  );
}
