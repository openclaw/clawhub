const CASE_SENSITIVE_PACKAGE_BASENAMES = new Map([
  ["skill.md", "SKILL.md"],
  ["skills.md", "skills.md"],
  ["protocol.md", "PROTOCOL.md"],
]);

export type SkillPackageFileCaseCollision = {
  canonicalName: string;
  paths: string[];
};

export function findSkillPackageFileCaseCollisions(
  filePaths: Iterable<string>,
): SkillPackageFileCaseCollision[] {
  const groups = new Map<string, { canonicalName: string; paths: Map<string, string> }>();
  for (const path of filePaths) {
    const normalized = normalizePackagePath(path);
    if (!normalized) continue;
    const segments = normalized.split("/");
    const basename = segments.at(-1);
    if (!basename) continue;
    const canonicalName = CASE_SENSITIVE_PACKAGE_BASENAMES.get(basename.toLowerCase());
    if (!canonicalName) continue;
    const directory = segments.slice(0, -1).join("/");
    const key = `${directory.toLowerCase()}/${basename.toLowerCase()}`;
    const group = groups.get(key) ?? {
      canonicalName,
      paths: new Map<string, string>(),
    };
    group.paths.set(normalized, normalized);
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map((group) => {
      const paths = Array.from(group.paths.values()).sort((a, b) => a.localeCompare(b));
      return paths.length > 1 ? { canonicalName: group.canonicalName, paths } : null;
    })
    .filter((collision): collision is SkillPackageFileCaseCollision => collision !== null)
    .sort((a, b) => (a.paths[0] ?? "").localeCompare(b.paths[0] ?? ""));
}

export function formatSkillPackageFileCaseCollisionError(
  collisions: readonly SkillPackageFileCaseCollision[],
) {
  const first = collisions[0];
  if (!first) return "Remove case-colliding skill package files.";
  const extra = collisions.length > 1 ? ` and ${collisions.length - 1} more collision(s)` : "";
  return `Remove case-colliding ${first.canonicalName} files: ${first.paths.join(", ")}${extra}.`;
}

function normalizePackagePath(path: string) {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}
