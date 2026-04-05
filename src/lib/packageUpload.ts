import ignore from "ignore";

type NormalizePackageUploadPathOptions = {
  stripTopLevelFolder?: boolean;
};

type UploadablePackageFile = {
  name: string;
  size: number;
  type: string;
  webkitRelativePath?: string;
};

export type NormalizedPackageUploadFile<
  TFile extends UploadablePackageFile = UploadablePackageFile,
> = {
  file: TFile;
  path: string;
};

const KNOWN_PACKAGE_ROOT_PATHS = new Set([
  "package.json",
  "openclaw.plugin.json",
  "openclaw.bundle.json",
  "README.md",
  "readme.md",
  "README.mdx",
  "readme.mdx",
]);
const DOT_DIR = ".clawhub";
const LEGACY_DOT_DIR = ".clawdhub";
const DOT_IGNORE = ".clawhubignore";
const LEGACY_DOT_IGNORE = ".clawdhubignore";
const PACKAGE_IGNORE_FILES = new Set([DOT_IGNORE, LEGACY_DOT_IGNORE]);
const DEFAULT_PACKAGE_IGNORE_PATTERNS = [
  ".git/",
  "node_modules/",
  `${DOT_DIR}/`,
  `${LEGACY_DOT_DIR}/`,
];

export function normalizePackageUploadPath(
  path: string,
  options: NormalizePackageUploadPathOptions = {},
) {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "";
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  if (!options.stripTopLevelFolder) return parts.join("/");
  return parts.slice(1).join("/") || (parts.at(-1) ?? "");
}

function getRawUploadPath<TFile extends UploadablePackageFile>(file: TFile) {
  return file.webkitRelativePath?.trim() || file.name;
}

function getNormalizedUploadPath<TFile extends UploadablePackageFile>(
  file: TFile,
  options: NormalizePackageUploadPathOptions = {},
) {
  return normalizePackageUploadPath(getRawUploadPath(file), options) || file.name;
}

function shouldStripSharedTopLevelFolder<TFile extends UploadablePackageFile>(files: TFile[]) {
  if (files.length === 0) return false;
  const partsList = files
    .map((file) => getNormalizedUploadPath(file))
    .filter(Boolean)
    .map((path) => path.split("/").filter(Boolean));
  if (partsList.length === 0 || partsList.some((parts) => parts.length < 2)) return false;

  const firstSegment = partsList[0]?.[0];
  if (!firstSegment) return false;
  if (!partsList.every((parts) => parts[0] === firstSegment)) return false;

  return partsList
    .map((parts) => parts.slice(1).join("/"))
    .some((path) => KNOWN_PACKAGE_ROOT_PATHS.has(path));
}

export function normalizePackageUploadFiles<TFile extends UploadablePackageFile>(
  files: TFile[],
): NormalizedPackageUploadFile<TFile>[] {
  const stripTopLevelFolder = shouldStripSharedTopLevelFolder(files);
  return files.map((file) => ({
    file,
    path: getNormalizedUploadPath(file, { stripTopLevelFolder }),
  }));
}

export async function filterIgnoredPackageFiles<
  TFile extends UploadablePackageFile & Pick<File, "text">,
>(files: TFile[]) {
  const normalized = normalizePackageUploadFiles(files);
  const ig = ignore();
  ig.add(DEFAULT_PACKAGE_IGNORE_PATTERNS);

  for (const entry of normalized) {
    if (!PACKAGE_IGNORE_FILES.has(entry.path)) continue;
    ig.add((await entry.file.text()).split(/\r?\n/));
  }

  const kept: TFile[] = [];
  const ignoredPaths: string[] = [];
  for (const entry of normalized) {
    if (ig.ignores(entry.path)) {
      ignoredPaths.push(entry.path);
      continue;
    }
    kept.push(entry.file);
  }

  return { files: kept, ignoredPaths };
}

export async function buildPackageUploadEntries<TFile extends UploadablePackageFile>(
  files: TFile[],
  options: {
    generateUploadUrl: () => Promise<string>;
    hashFile: (file: TFile) => Promise<string>;
    uploadFile: (uploadUrl: string, file: TFile) => Promise<string>;
  },
) {
  const uploaded: Array<{
    path: string;
    size: number;
    storageId: string;
    sha256: string;
    contentType?: string;
  }> = [];

  for (const { file, path } of normalizePackageUploadFiles(files)) {
    const sha256 = await options.hashFile(file);
    const uploadUrl = await options.generateUploadUrl();
    const storageId = await options.uploadFile(uploadUrl, file);
    uploaded.push({
      path,
      size: file.size,
      storageId,
      sha256,
      contentType: file.type || undefined,
    });
  }

  return uploaded;
}
