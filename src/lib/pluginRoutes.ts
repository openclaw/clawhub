export function parseScopedPackageName(name: string): { scope: string; name: string } | null {
  const trimmed = name.trim();
  if (!trimmed.startsWith("@")) return null;

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 1 || slashIndex === trimmed.length - 1) return null;

  const scope = trimmed.slice(0, slashIndex);
  const packageName = trimmed.slice(slashIndex + 1);
  if (packageName.includes("/")) return null;

  return { scope, name: packageName };
}

export function displayPluginPackageName(name: string) {
  return parseScopedPackageName(name)?.name ?? name;
}

export function buildPluginDetailHref(name: string) {
  const scoped = parseScopedPackageName(name);
  if (!scoped) return `/plugins/${encodeURIComponent(name)}`;

  return `/plugins/@${encodeURIComponent(scoped.scope.slice(1))}/${encodeURIComponent(
    scoped.name,
  )}`;
}

export function buildPluginSecurityAuditHref(name: string) {
  return `${buildPluginDetailHref(name)}/security-audit`;
}

export function buildPluginValidationHref(name: string) {
  return `${buildPluginDetailHref(name)}#validation`;
}

export function packageNameFromScopedRoute(scope: string, name: string) {
  if (!scope.startsWith("@") || !name || name.includes("/")) return null;
  return `${scope}/${name}`;
}
