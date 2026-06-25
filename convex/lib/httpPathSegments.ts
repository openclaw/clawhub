export type PackagePathRoute = {
  packageName: string;
  rest: string[];
};

export function getPathSegments(request: Request, prefix: string) {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(prefix)) return [];
  const rest = pathname.slice(prefix.length);
  return rest
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

export function parsePackagePathSegments(segments: string[]): PackagePathRoute | null {
  if (segments.length === 0) return null;
  const firstSegment = decodePackagePathSegment(segments[0]!);
  if (firstSegment.startsWith("@")) {
    if (firstSegment.includes("/")) {
      const [scope, name, ...encodedRest] = firstSegment.split("/");
      if (!scope || !name) return null;
      return {
        packageName: `${scope}/${name}`,
        rest: [...encodedRest, ...segments.slice(1)],
      };
    }
    if (segments.length < 2) return null;
    return {
      packageName: `${firstSegment}/${decodePackagePathSegment(segments[1]!)}`,
      rest: segments.slice(2),
    };
  }
  return {
    packageName: firstSegment,
    rest: segments.slice(1),
  };
}

function decodePackagePathSegment(segment: string) {
  let decoded = segment;
  for (let i = 0; i < 2 && decoded.includes("%"); i += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}
