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

type PluginRouteOptions = {
  ownerHandle?: string | null;
};

function cleanOwnerHandle(ownerHandle: string | null | undefined) {
  return ownerHandle?.trim().replace(/^@+/, "") || null;
}

function routeSegment(value: string) {
  return encodeURIComponent(value.trim().replace(/^@+/, ""));
}

export function buildPluginDetailHref(name: string, options: PluginRouteOptions = {}) {
  const scoped = parseScopedPackageName(name);
  const ownerHandle = cleanOwnerHandle(scoped?.scope) ?? cleanOwnerHandle(options.ownerHandle);

  if (ownerHandle) {
    return `/${routeSegment(ownerHandle)}/plugins/${routeSegment(scoped?.name ?? name)}`;
  }

  if (!scoped) return `/plugins/${encodeURIComponent(name)}`;

  return `/plugins/@${encodeURIComponent(scoped.scope.slice(1))}/${encodeURIComponent(
    scoped.name,
  )}`;
}

export function buildPluginSecurityAuditHref(name: string, options: PluginRouteOptions = {}) {
  return `${buildPluginDetailHref(name, options)}/security-audit`;
}

export function buildPluginCanonicalHrefForRequestedPath(
  pathname: string,
  requestedName: string,
  resolvedName: string,
  options: PluginRouteOptions = {},
) {
  const requestedDetailPath = buildPluginDetailHref(requestedName);
  if (
    pathname === `${requestedDetailPath}/security-audit` ||
    pathname.startsWith(`${requestedDetailPath}/security/`)
  ) {
    return buildPluginSecurityAuditHref(resolvedName, options);
  }
  return buildPluginDetailHref(resolvedName, options);
}

export function buildPluginValidationHref(name: string) {
  return `${buildPluginDetailHref(name)}#validation`;
}

export function packageNameFromScopedRoute(scope: string, name: string) {
  if (!scope.startsWith("@") || !name || name.includes("/")) return null;
  return `${scope}/${name}`;
}

export function packageNameFromPublisherPluginRoute(owner: string, name: string) {
  const ownerHandle = cleanOwnerHandle(owner);
  if (!ownerHandle || !name || name.includes("/")) return null;
  return `@${ownerHandle}/${name}`;
}
