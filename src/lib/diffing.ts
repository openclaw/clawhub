import semver from "semver";

export const MAX_DIFF_FILE_BYTES = 200 * 1024;

type TagMap<IdType extends string> = Record<string, IdType>;

export type VersionEntry<IdType extends string = string> = {
  id: IdType;
  version: string;
};

export type FileMeta = {
  path: string;
  sha256: string;
  size: number;
};

export type FileDiffStatus = "added" | "removed" | "changed" | "same";

export type FileDiffItem = {
  path: string;
  status: FileDiffStatus;
  left?: FileMeta;
  right?: FileMeta;
};

export function sortVersionsBySemver<IdType extends string>(versions: VersionEntry<IdType>[]) {
  return [...versions].sort((a, b) => {
    const aValid = Boolean(semver.valid(a.version));
    const bValid = Boolean(semver.valid(b.version));
    if (aValid && bValid) return semver.rcompare(a.version, b.version);
    if (aValid) return -1;
    if (bValid) return 1;
    return a.version.localeCompare(b.version);
  });
}

export function resolveLatestVersionId<IdType extends string>(
  versions: VersionEntry<IdType>[],
  tags?: TagMap<IdType>,
) {
  if (tags?.latest) return tags.latest;
  return sortVersionsBySemver(versions)[0]?.id ?? null;
}

export function resolvePreviousVersionId<IdType extends string>(
  versions: VersionEntry<IdType>[],
  latestId?: IdType | null,
) {
  const ordered = sortVersionsBySemver(versions);
  if (!latestId) return ordered[1]?.id ?? null;
  const latestIndex = ordered.findIndex((entry) => entry.id === latestId);
  if (latestIndex === -1) return ordered[1]?.id ?? null;
  return ordered[latestIndex + 1]?.id ?? null;
}

export function getDefaultDiffSelection<IdType extends string>(
  versions: VersionEntry<IdType>[],
  tags?: TagMap<IdType>,
) {
  const latestId = resolveLatestVersionId(versions, tags);
  const previousId = resolvePreviousVersionId(versions, latestId);
  return {
    leftId: previousId ?? latestId ?? null,
    rightId: latestId ?? previousId ?? null,
  };
}

export function buildFileDiffList(leftFiles: FileMeta[], rightFiles: FileMeta[]) {
  const entries = new Map<string, { left?: FileMeta; right?: FileMeta }>();
  for (const file of leftFiles) {
    entries.set(file.path, { left: file });
  }
  for (const file of rightFiles) {
    const existing = entries.get(file.path) ?? {};
    entries.set(file.path, { ...existing, right: file });
  }

  const statusRank: Record<FileDiffStatus, number> = {
    changed: 0,
    added: 1,
    removed: 2,
    same: 3,
  };

  return Array.from(entries.entries())
    .map(([path, info]) => {
      let status: FileDiffStatus = "same";
      if (info.left && !info.right) status = "removed";
      else if (!info.left && info.right) status = "added";
      else if (info.left?.sha256 !== info.right?.sha256) status = "changed";
      return { path, status, left: info.left, right: info.right };
    })
    .sort((a, b) => {
      const statusDiff = statusRank[a.status] - statusRank[b.status];
      if (statusDiff !== 0) return statusDiff;
      return a.path.localeCompare(b.path);
    });
}

export function selectDefaultFilePath(items: FileDiffItem[]) {
  const readme = items.find((item) => item.path.toLowerCase() === "skill.md");
  if (readme) return readme.path;
  const changed = items.find((item) => item.status !== "same");
  return changed?.path ?? items[0]?.path ?? null;
}
