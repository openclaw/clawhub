import type { ActionCtx } from "../_generated/server";
import { isTextFile } from "./skills";

export const PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES = {
  RAW_FS_USAGE: "info.filesystem.raw_fs_api_usage",
  FS_SAFE_USAGE: "info.filesystem.fs_safe_usage",
} as const;

type PackageDryRunFilesystemReasonCode =
  (typeof PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES)[keyof typeof PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES];

export type PackageDryRunFilesystemFindingLike = {
  code: string;
  severity: string;
  file: string;
  line: number;
  message: string;
  evidence: string;
};

export type PackageDryRunFilesystemEvidenceItem = {
  code: PackageDryRunFilesystemReasonCode;
  severity: string;
  file: string;
  line: number;
  message: string;
  evidence: string;
  evidenceTruncated: boolean;
};

export type PackageDryRunFilesystemEvidenceBucket = {
  reasonCode: PackageDryRunFilesystemReasonCode;
  totalCount: number;
  returnedCount: number;
  omittedCount: number;
  truncatedEvidenceCount: number;
  evidence: PackageDryRunFilesystemEvidenceItem[];
};

export type PackageDryRunFilesystemEvidence = {
  rawFsUsage: PackageDryRunFilesystemEvidenceBucket;
  fsSafeUsage: PackageDryRunFilesystemEvidenceBucket;
};

type BuildPackageDryRunFilesystemEvidenceOptions = {
  maxEvidenceItems?: number;
  maxEvidenceChars?: number;
};

type PackageDryRunFilesystemScanInput = {
  files: Array<{
    path: string;
    storageId: string;
    size?: number;
    contentType?: string;
  }>;
};

type PackageDryRunFilesystemEvidenceAccumulator = {
  rawFsUsage: PackageDryRunFilesystemBucketAccumulator;
  fsSafeUsage: PackageDryRunFilesystemBucketAccumulator;
};

type PackageDryRunFilesystemBucketAccumulator = {
  reasonCode: PackageDryRunFilesystemReasonCode;
  totalCount: number;
  findings: PackageDryRunFilesystemFindingLike[];
};

const DEFAULT_MAX_EVIDENCE_ITEMS = 5;
const DEFAULT_MAX_EVIDENCE_CHARS = 160;
const MAX_SCAN_FILE_BYTES = 256 * 1024;
const MAX_SCAN_RELEASE_BYTES = 2 * 1024 * 1024;
const ELLIPSIS = "...";
const RAW_FS_METHODS = [
  "access",
  "accessSync",
  "appendFile",
  "appendFileSync",
  "chmod",
  "chmodSync",
  "chown",
  "chownSync",
  "close",
  "closeSync",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
  "createReadStream",
  "createWriteStream",
  "exists",
  "existsSync",
  "fchmod",
  "fchmodSync",
  "fchown",
  "fchownSync",
  "fdatasync",
  "fdatasyncSync",
  "fstat",
  "fstatSync",
  "fsync",
  "fsyncSync",
  "ftruncate",
  "ftruncateSync",
  "futimes",
  "futimesSync",
  "lchmod",
  "lchmodSync",
  "lchown",
  "lchownSync",
  "link",
  "linkSync",
  "lstat",
  "lstatSync",
  "lutimes",
  "lutimesSync",
  "mkdir",
  "mkdirSync",
  "mkdtemp",
  "mkdtempSync",
  "open",
  "openSync",
  "opendir",
  "opendirSync",
  "read",
  "readSync",
  "readdir",
  "readdirSync",
  "readFile",
  "readFileSync",
  "readlink",
  "readlinkSync",
  "readv",
  "readvSync",
  "realpath",
  "realpathSync",
  "rename",
  "renameSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "stat",
  "statSync",
  "statfs",
  "statfsSync",
  "symlink",
  "symlinkSync",
  "truncate",
  "truncateSync",
  "unlink",
  "unlinkSync",
  "unwatchFile",
  "utimes",
  "utimesSync",
  "watch",
  "watchFile",
  "write",
  "writeSync",
  "writeFile",
  "writeFileSync",
  "writev",
  "writevSync",
] as const;
const RAW_FS_METHOD_PATTERN = RAW_FS_METHODS.map((name) => escapeRegExp(name))
  .sort((left, right) => right.length - left.length)
  .join("|");
const OPTIONAL_MEMBER_ACCESS_PATTERN = String.raw`\s*(?:\?\.|\.)\s*`;
const RAW_FS_MODULE_PATTERN =
  /\b(?:import\s+(?!type\b)(?:(?:[^;"']+)\s+from\s*)?["'](?:node:)?fs(?:\/promises)?["']|export\s+(?!type\b)(?:(?:\*\s+as\s+[A-Za-z_$][\w$]*|\*|\{[^}]+\})\s+from\s*)["'](?:node:)?fs(?:\/promises)?["']|import\s+[A-Za-z_$][\w$]*\s*=\s*require\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)|require\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)|import\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\))/;
const RAW_FS_TYPE_ONLY_IMPORT_PATTERN =
  /\bimport\s+type\s+(?:(?:[^;"']+)\s+from\s*["'](?:node:)?fs(?:\/promises)?["']|[A-Za-z_$][\w$]*\s*=\s*require\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\))/;
const RAW_FS_NAMED_IMPORT_PATTERN =
  /import\s*\{([^}]+)\}\s*from\s*["'](?:node:)?fs(?:\/promises)?["']/;
const RAW_FS_NAMED_EXPORT_PATTERN =
  /export\s*\{([^}]+)\}\s*from\s*["'](?:node:)?fs(?:\/promises)?["']/;
const RAW_FS_NAMESPACE_PATTERN =
  /(?:import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["'](?:node:)?fs(?:\/promises)?["']|import\s+([A-Za-z_$][\w$]*)\s+from\s*["'](?:node:)?fs(?:\/promises)?["']|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+import\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)|import\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\))/;
const RAW_FS_DEFAULT_NAMESPACE_ALIAS_PATTERN =
  /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*=\s*(?:require\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)|await\s+import\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\))/;
const RAW_FS_COMBINED_NAMESPACE_IMPORT_PATTERN =
  /import\s+([A-Za-z_$][\w$]*)\s*,\s*\{[^}]*\}\s*from\s*["'](?:node:)?fs(?:\/promises)?["']/;
const RAW_FS_DEFAULT_ALIAS_PATTERN =
  /import\s*\{[^}]*\bdefault\s+as\s+([A-Za-z_$][\w$]*)[^}]*\}\s*from\s*["'](?:node:)?fs(?:\/promises)?["']/;
const RAW_FS_PROMISES_ALIAS_PATTERN =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["'](?:node:)?fs["']\s*\)\s*(?:\?\.|\.)\s*promises\b/;
const RAW_FS_NAMESPACE_PROMISES_ALIAS_PATTERN =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*promises\b/;
const RAW_FS_DESTRUCTURED_IMPORT_PATTERN =
  /(?:import\s*\{([^}]+)\}\s*from\s*["'](?:node:)?fs(?:\/promises)?["']|(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)|(?:const|let|var)\s*\{([^}]+)\}\s*=\s*await\s+import\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\))/;
const RAW_FS_COMBINED_DESTRUCTURED_IMPORT_PATTERN =
  /import\s+[A-Za-z_$][\w$]*\s*,\s*\{([^}]+)\}\s*from\s*["'](?:node:)?fs(?:\/promises)?["']/;
const RAW_FS_PROMISES_DESTRUCTURED_IMPORT_PATTERN =
  /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*["'](?:node:)?fs["']\s*\)\s*(?:\?\.|\.)\s*promises\b/;
const RAW_FS_NAMESPACE_PROMISES_DESTRUCTURED_PATTERN =
  /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*promises\b/;
const RAW_FS_NAMESPACE_DESTRUCTURED_PATTERN =
  /(?:const|let|var)\s*\{((?:[^{}]|\{[^{}]*\})+)\}\s*=\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\b/;
const RAW_FS_PROMISES_ALIAS_DECLARATOR_PATTERN =
  /^([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["'](?:node:)?fs["']\s*\)\s*(?:\?\.|\.)\s*promises\b/;
const RAW_FS_NAMESPACE_PROMISES_ALIAS_DECLARATOR_PATTERN =
  /^([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*promises\b/;
const RAW_FS_NAMESPACE_MEMBER_ALIAS_PATTERN = new RegExp(
  String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)${OPTIONAL_MEMBER_ACCESS_PATTERN}(?:(?:promises)${OPTIONAL_MEMBER_ACCESS_PATTERN})?(?:${RAW_FS_METHOD_PATTERN})\b`,
);
const RAW_FS_NAMESPACE_MEMBER_ALIAS_DECLARATOR_PATTERN = new RegExp(
  String.raw`^([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)${OPTIONAL_MEMBER_ACCESS_PATTERN}(?:(?:promises)${OPTIONAL_MEMBER_ACCESS_PATTERN})?(?:${RAW_FS_METHOD_PATTERN})\b`,
);
const RAW_FS_MODULE_MEMBER_ALIAS_PATTERN = new RegExp(
  String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:require\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)|await\s+import\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\))${OPTIONAL_MEMBER_ACCESS_PATTERN}(?:(?:promises)${OPTIONAL_MEMBER_ACCESS_PATTERN})?(?:${RAW_FS_METHOD_PATTERN})\b`,
);
const RAW_FS_MODULE_MEMBER_ALIAS_DECLARATOR_PATTERN = new RegExp(
  String.raw`^([A-Za-z_$][\w$]*)\s*=\s*(?:require\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)|await\s+import\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\))${OPTIONAL_MEMBER_ACCESS_PATTERN}(?:(?:promises)${OPTIONAL_MEMBER_ACCESS_PATTERN})?(?:${RAW_FS_METHOD_PATTERN})\b`,
);
const RAW_FS_DESTRUCTURED_NAMES = new Set<string>(RAW_FS_METHODS);
const FS_SAFE_MODULE_SPECIFIER_PATTERN = String.raw`(?:@openclaw\/fs-safe|openclaw\/plugin-sdk\/(?:security-runtime|file-access-runtime))`;
const FS_SAFE_HELPERS = [
  "openFileWithinRoot",
  "readFileWithinRoot",
  "writeFileWithinRoot",
  "writeFileFromPathWithinRoot",
  "writeExternalFileWithinRoot",
  "sanitizeUntrustedFileName",
  "writeViaSiblingTempPath",
] as const;
const FS_SAFE_HELPER_PATTERN = FS_SAFE_HELPERS.map((name) => escapeRegExp(name))
  .sort((left, right) => right.length - left.length)
  .join("|");
const FS_SAFE_HELPER_NAMES = new Set<string>(FS_SAFE_HELPERS);
const FS_SAFE_MODULE_PATTERN = new RegExp(
  String.raw`\b(?:import\s+(?!type\b)(?:(?:[^;"']+)\s+from\s*)?["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']|export\s+(?!type\b)(?:(?:\*\s+as\s+[A-Za-z_$][\w$]*|\*|\{[^}]+\})\s+from\s*)["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']|require\(\s*["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']\s*\)|import\(\s*["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']\s*\))`,
);
const FS_SAFE_TYPE_ONLY_IMPORT_PATTERN = new RegExp(
  String.raw`\bimport\s+type\s+(?:(?:[^;"']+)\s+from\s*["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']|[A-Za-z_$][\w$]*\s*=\s*require\(\s*["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']\s*\))`,
);
const FS_SAFE_NAMED_IMPORT_PATTERN = new RegExp(
  String.raw`import\s*\{([^}]+)\}\s*from\s*["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']`,
);
const FS_SAFE_NAMED_EXPORT_PATTERN = new RegExp(
  String.raw`export\s*\{([^}]+)\}\s*from\s*["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']`,
);
const FS_SAFE_COMBINED_NAMED_IMPORT_PATTERN = new RegExp(
  String.raw`import\s+[A-Za-z_$][\w$]*\s*,\s*\{([^}]+)\}\s*from\s*["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']`,
);
const FS_SAFE_NAMESPACE_PATTERN = new RegExp(
  String.raw`(?:import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:require\(\s*["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']\s*\)|await\s+import\(\s*["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']\s*\)))`,
);
const FS_SAFE_NAMESPACE_DECLARATOR_PATTERN = new RegExp(
  String.raw`^([A-Za-z_$][\w$]*)\s*=\s*(?:require\(\s*["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']\s*\)|await\s+import\(\s*["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']\s*\))`,
);
const FS_SAFE_DESTRUCTURED_IMPORT_PATTERN = new RegExp(
  String.raw`(?:import\s*\{([^}]+)\}\s*from\s*["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']|(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(?:require\(\s*["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']\s*\)|await\s+import\(\s*["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']\s*\)))`,
);
const FS_SAFE_NAMESPACE_DESTRUCTURED_PATTERN =
  /(?:const|let|var)\s*\{((?:[^{}]|\{[^{}]*\})+)\}\s*=\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\b/;
const FS_SAFE_NAMESPACE_MEMBER_ALIAS_PATTERN = new RegExp(
  String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)${OPTIONAL_MEMBER_ACCESS_PATTERN}(?:${FS_SAFE_HELPER_PATTERN})\b`,
);
const FS_SAFE_NAMESPACE_MEMBER_ALIAS_DECLARATOR_PATTERN = new RegExp(
  String.raw`^([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)${OPTIONAL_MEMBER_ACCESS_PATTERN}(?:${FS_SAFE_HELPER_PATTERN})\b`,
);

export async function runPackageDryRunFilesystemScan(
  ctx: Pick<ActionCtx, "storage">,
  input: PackageDryRunFilesystemScanInput,
): Promise<PackageDryRunFilesystemEvidence> {
  const accumulator = createPackageDryRunFilesystemEvidenceAccumulator();
  let scannedBytes = 0;
  for (const file of input.files) {
    if (!isTextFile(file.path, file.contentType ?? undefined)) continue;
    const fileSize = file.size;
    if (!isScanFileSizeAllowed(fileSize)) continue;
    const remainingBytes = MAX_SCAN_RELEASE_BYTES - scannedBytes;
    if (remainingBytes <= 0) break;
    const read = await readStorageTextWithinLimit(ctx, file.storageId, remainingBytes);
    if (read === null) continue;
    scannedBytes += read.size;
    scanPackageDryRunFilesystemContentWithRecorder(file.path, read.content, (finding) =>
      recordPackageDryRunFilesystemFinding(accumulator, finding, DEFAULT_MAX_EVIDENCE_ITEMS),
    );
  }
  return buildPackageDryRunFilesystemEvidenceFromAccumulator(accumulator);
}

async function readStorageTextWithinLimit(
  ctx: Pick<ActionCtx, "storage">,
  storageId: string,
  remainingBytes: number,
) {
  const blob = await ctx.storage.get(storageId as never);
  if (!blob) throw new Error("Uploaded file no longer exists");
  if (!isScanFileSizeAllowed(blob.size)) return null;
  if (blob.size > remainingBytes) return null;
  return { content: await blob.text(), size: blob.size };
}

function isScanFileSizeAllowed(size: number | undefined): size is number {
  return (
    typeof size === "number" && Number.isInteger(size) && size >= 0 && size <= MAX_SCAN_FILE_BYTES
  );
}

export function scanPackageDryRunFilesystemContent(
  path: string,
  content: string,
): PackageDryRunFilesystemFindingLike[] {
  const findings: PackageDryRunFilesystemFindingLike[] = [];
  scanPackageDryRunFilesystemContentWithRecorder(path, content, (finding) =>
    findings.push(finding),
  );
  return findings;
}

function scanPackageDryRunFilesystemContentWithRecorder(
  path: string,
  content: string,
  recordFinding: (finding: PackageDryRunFilesystemFindingLike) => void,
) {
  const evidenceLines = content.split(/\r?\n/);
  const sanitizedContent = stripTypeOnlyFsSafeImports(
    stripTypeOnlyFsImports(sanitizeFilesystemScanCode(content)),
  );
  const scanLines = sanitizedContent.split(/\r?\n/);
  const rawFsModuleUsageEvidenceByLine = collectRawFsModuleUsageEvidenceByLine(
    sanitizedContent,
    evidenceLines,
  );
  const fsSafeModuleUsageEvidenceByLine = collectFsSafeModuleUsageEvidenceByLine(
    sanitizedContent,
    evidenceLines,
  );
  const namespaceFsNamesByLine = collectNamespaceFsNamesByLine(scanLines);
  const namespaceFsNames = collectNamesFromLines(namespaceFsNamesByLine);
  const destructuredFsNamesByLine = collectDestructuredFsNamesByLine(
    scanLines,
    namespaceFsNamesByLine,
  );
  const destructuredFsNames = collectNamesFromLines(destructuredFsNamesByLine);
  const fsSafeNamespaceNamesByLine = collectFsSafeNamespaceNamesByLine(scanLines);
  const fsSafeHelperNamesByLine = collectFsSafeHelperNamesByLine(
    scanLines,
    fsSafeNamespaceNamesByLine,
  );
  const fsSafeNamespaceNames = collectNamesFromLines(fsSafeNamespaceNamesByLine);
  const fsSafeHelperNames = collectNamesFromLines(fsSafeHelperNamesByLine);
  const namespaceFsDeclarationsByLine = collectNewlyActiveNamesByLine(namespaceFsNamesByLine);
  const destructuredFsDeclarationsByLine = collectNewlyActiveNamesByLine(destructuredFsNamesByLine);
  const fsSafeNamespaceDeclarationsByLine = collectNewlyActiveNamesByLine(
    fsSafeNamespaceNamesByLine,
  );
  const fsSafeHelperDeclarationsByLine = collectNewlyActiveNamesByLine(fsSafeHelperNamesByLine);
  const namespaceShadowsByLine = collectShadowedNamesByLine(
    scanLines,
    namespaceFsNames,
    namespaceFsDeclarationsByLine,
  );
  const availableNamespaceFsNamesByLine = subtractShadowedNamesByLine(
    namespaceFsNamesByLine,
    namespaceShadowsByLine,
  );
  const destructuredShadowsByLine = collectShadowedNamesByLine(
    scanLines,
    destructuredFsNames,
    destructuredFsDeclarationsByLine,
    availableNamespaceFsNamesByLine,
  );
  const fsSafeNamespaceShadowsByLine = collectShadowedNamesByLine(
    scanLines,
    fsSafeNamespaceNames,
    fsSafeNamespaceDeclarationsByLine,
  );
  const fsSafeHelperShadowsByLine = collectShadowedNamesByLine(
    scanLines,
    fsSafeHelperNames,
    fsSafeHelperDeclarationsByLine,
    fsSafeNamespaceNamesByLine,
  );
  for (let index = 0; index < scanLines.length; index += 1) {
    const line = scanLines[index] ?? "";
    const rawFsModuleUsageEvidence = rawFsModuleUsageEvidenceByLine.get(index);
    const evidence = rawFsModuleUsageEvidence ?? (evidenceLines[index] ?? "").trim();
    if (
      rawFsModuleUsageEvidence !== undefined ||
      hasNamespaceFsCall(
        line,
        namespaceFsNamesByLine[index] ?? new Set(),
        namespaceShadowsByLine[index] ?? new Set(),
      )
    ) {
      recordFinding({
        code: PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.RAW_FS_USAGE,
        severity: "info",
        file: path,
        line: index + 1,
        message: "Raw Node filesystem API usage detected.",
        evidence,
      });
    } else if (
      hasDestructuredFsCall(
        line,
        destructuredFsNamesByLine[index] ?? new Set(),
        destructuredShadowsByLine[index] ?? new Set(),
      )
    ) {
      recordFinding({
        code: PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.RAW_FS_USAGE,
        severity: "info",
        file: path,
        line: index + 1,
        message: "Raw filesystem helper usage detected.",
        evidence,
      });
    }
    const fsSafeModuleUsageEvidence = fsSafeModuleUsageEvidenceByLine.get(index);
    const fsSafeEvidence = fsSafeModuleUsageEvidence ?? (evidenceLines[index] ?? "").trim();
    if (
      fsSafeModuleUsageEvidence !== undefined ||
      hasNamespaceFsSafeCall(
        line,
        fsSafeNamespaceNamesByLine[index] ?? new Set(),
        fsSafeNamespaceShadowsByLine[index] ?? new Set(),
      ) ||
      hasDestructuredFsCall(
        line,
        fsSafeHelperNamesByLine[index] ?? new Set(),
        fsSafeHelperShadowsByLine[index] ?? new Set(),
      )
    ) {
      recordFinding({
        code: PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.FS_SAFE_USAGE,
        severity: "info",
        file: path,
        line: index + 1,
        message: "OpenClaw filesystem safety helper usage detected.",
        evidence: fsSafeEvidence,
      });
    }
  }
}

function sanitizeFilesystemScanCode(content: string) {
  let output = "";
  let index = 0;
  let inBlockComment = false;

  while (index < content.length) {
    const character = content[index] ?? "";
    const next = content[index + 1] ?? "";

    if (inBlockComment) {
      if (character === "*" && next === "/") {
        output += "  ";
        index += 2;
        inBlockComment = false;
      } else {
        output += character === "\n" || character === "\r" ? character : " ";
        index += 1;
      }
      continue;
    }

    if (character === "/" && next === "*") {
      output += "  ";
      index += 2;
      inBlockComment = true;
      continue;
    }

    if (character === "/" && next === "/") {
      output += "  ";
      index += 2;
      while (index < content.length && content[index] !== "\n" && content[index] !== "\r") {
        output += " ";
        index += 1;
      }
      continue;
    }

    if (character === "/" && isLikelyRegexLiteralStart(output)) {
      const result = sanitizeRegexLiteral(content, index);
      if (result) {
        output += result.value;
        index = result.nextIndex;
        continue;
      }
    }

    if (character === "'" || character === '"' || character === "`") {
      const result = sanitizeStringLiteral(content, index, output);
      output += result.value;
      index = result.nextIndex;
      continue;
    }

    output += character;
    index += 1;
  }

  return output;
}

function sanitizeRegexLiteral(content: string, startIndex: number) {
  let value = "/";
  let index = startIndex + 1;
  let inCharacterClass = false;

  while (index < content.length) {
    const character = content[index] ?? "";
    const next = content[index + 1] ?? "";
    if (character === "\n" || character === "\r") return null;
    if (character === "\\") {
      value += " ";
      if (index + 1 < content.length) {
        value += next === "\n" || next === "\r" ? next : " ";
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (character === "[") inCharacterClass = true;
    if (character === "]") inCharacterClass = false;
    if (character === "/" && !inCharacterClass) {
      value += "/";
      index += 1;
      while (/[A-Za-z]/.test(content[index] ?? "")) {
        value += " ";
        index += 1;
      }
      return { value, nextIndex: index };
    }
    value += " ";
    index += 1;
  }

  return null;
}

function isLikelyRegexLiteralStart(outputBeforeSlash: string) {
  let index = outputBeforeSlash.length - 1;
  while (index >= 0 && /\s/.test(outputBeforeSlash[index] ?? "")) index -= 1;
  if (index < 0) return true;
  const previous = outputBeforeSlash[index] ?? "";
  const prefix = outputBeforeSlash.slice(0, index + 1);
  if (/(^|[^\w$])(?:return|throw|yield|case|delete|void|typeof|instanceof|in)\s*$/.test(prefix)) {
    return true;
  }
  if (/(^|[;{}])\s*(?:if|while|for|with)\s*\([^)]*\)\s*$/.test(prefix)) {
    return true;
  }
  return "([{=,:;!&|?+-*~^<>".includes(previous);
}

function sanitizeStringLiteral(content: string, startIndex: number, outputBeforeLiteral: string) {
  const quote = content[startIndex] ?? "";
  const preserveLiteral = shouldPreserveModuleSpecifierLiteral(outputBeforeLiteral);
  let value = quote;
  let index = startIndex + 1;

  while (index < content.length) {
    const character = content[index] ?? "";
    const next = content[index + 1] ?? "";
    if (character === "\\") {
      value += preserveLiteral ? character : " ";
      if (index + 1 < content.length) {
        value += next === "\n" || next === "\r" ? next : preserveLiteral ? next : " ";
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    if (!preserveLiteral && quote === "`" && character === "$" && next === "{") {
      const closeIndex = findMatchingBrace(content, index + 1);
      if (closeIndex !== null) {
        value += `  ${sanitizeFilesystemScanCode(content.slice(index + 2, closeIndex))} `;
        index = closeIndex + 1;
        continue;
      }
    }

    if (character === quote) {
      value += quote;
      index += 1;
      break;
    }

    value +=
      character === "\n" || character === "\r" ? character : preserveLiteral ? character : " ";
    index += 1;
  }

  return { value, nextIndex: index };
}

function shouldPreserveModuleSpecifierLiteral(outputBeforeLiteral: string) {
  const linePrefix = outputBeforeLiteral.slice(outputBeforeLiteral.lastIndexOf("\n") + 1);
  return (
    /\bimport\s+(?!\()[^;"']*\bfrom\s*$/.test(linePrefix) ||
    /(?:^|[^\w$])from\s*$/.test(linePrefix) ||
    /\brequire\s*\(\s*$/.test(linePrefix) ||
    /\bimport\s*\(\s*$/.test(linePrefix)
  );
}

function stripTypeOnlyFsImports(line: string) {
  return line
    .replace(new RegExp(RAW_FS_TYPE_ONLY_IMPORT_PATTERN.source, "g"), (match: string) =>
      blankNonLineBreaks(match),
    )
    .replace(
      new RegExp(RAW_FS_NAMED_IMPORT_PATTERN.source, "g"),
      (match: string, specifiers: string) => {
        const typeOnly = specifiers
          .split(",")
          .map((specifier) => specifier.trim())
          .filter(Boolean)
          .every((specifier) => specifier.startsWith("type "));
        return typeOnly ? blankNonLineBreaks(match) : match;
      },
    )
    .replace(
      new RegExp(RAW_FS_NAMED_EXPORT_PATTERN.source, "g"),
      (match: string, specifiers: string) => {
        const typeOnly = specifiers
          .split(",")
          .map((specifier) => specifier.trim())
          .filter(Boolean)
          .every((specifier) => specifier.startsWith("type "));
        return typeOnly ? blankNonLineBreaks(match) : match;
      },
    );
}

function stripTypeOnlyFsSafeImports(line: string) {
  return line
    .replace(new RegExp(FS_SAFE_TYPE_ONLY_IMPORT_PATTERN.source, "g"), (match: string) =>
      blankNonLineBreaks(match),
    )
    .replace(new RegExp(FS_SAFE_NAMED_IMPORT_PATTERN.source, "g"), blankTypeOnlySpecifiers)
    .replace(new RegExp(FS_SAFE_NAMED_EXPORT_PATTERN.source, "g"), blankTypeOnlySpecifiers);
}

function blankTypeOnlySpecifiers(match: string, specifiers: string) {
  const typeOnly = specifiers
    .split(",")
    .map((specifier) => specifier.trim())
    .filter(Boolean)
    .every((specifier) => specifier.startsWith("type "));
  return typeOnly ? blankNonLineBreaks(match) : match;
}

function blankNonLineBreaks(value: string) {
  return value.replace(/[^\r\n]/g, " ");
}

function collectRawFsModuleUsageEvidenceByLine(content: string, evidenceLines: readonly string[]) {
  const evidenceByLine = new Map<number, string>();
  for (const match of content.matchAll(new RegExp(RAW_FS_MODULE_PATTERN.source, "g"))) {
    if (match.index === undefined) continue;
    const startLine = lineIndexForContentOffset(content, match.index);
    if (evidenceByLine.has(startLine)) continue;
    const endLine = lineIndexForContentOffset(content, match.index + match[0].length);
    evidenceByLine.set(startLine, evidenceForLineRange(evidenceLines, startLine, endLine));
  }
  return evidenceByLine;
}

function collectFsSafeModuleUsageEvidenceByLine(content: string, evidenceLines: readonly string[]) {
  const evidenceByLine = new Map<number, string>();
  for (const match of content.matchAll(new RegExp(FS_SAFE_MODULE_PATTERN.source, "g"))) {
    if (match.index === undefined) continue;
    const startLine = lineIndexForContentOffset(content, match.index);
    if (evidenceByLine.has(startLine)) continue;
    const endLine = lineIndexForContentOffset(content, match.index + match[0].length);
    evidenceByLine.set(startLine, evidenceForLineRange(evidenceLines, startLine, endLine));
  }
  return evidenceByLine;
}

function evidenceForLineRange(lines: readonly string[], startLine: number, endLine: number) {
  return lines
    .slice(startLine, endLine + 1)
    .join("\n")
    .trim();
}

type ScopedFsName = {
  name: string;
  line: number;
  endLineExclusive: number;
};

type ParameterSpan = {
  openIndex: number;
  closeIndex: number;
};

type VariableDeclarator = {
  text: string;
  startIndex: number;
  statementStartIndex: number;
  declaration: string;
};

type ObjectBindingVariableDeclarator = VariableDeclarator & {
  specifiers: string;
  source: string;
};

function collectNamespaceFsNamesByLine(lines: readonly string[]) {
  const declarations: ScopedFsName[] = [];
  const content = lines.join("\n");
  const variableDeclarators = findVariableDeclarators(content);
  for (const match of content.matchAll(new RegExp(RAW_FS_NAMESPACE_PATTERN, "g"))) {
    const name = match?.[1] ?? match?.[2] ?? match?.[3] ?? match?.[4] ?? match?.[5];
    if (name) declarations.push(createScopedFsName(lines, content, match, name));
  }
  for (const match of content.matchAll(new RegExp(RAW_FS_DEFAULT_NAMESPACE_ALIAS_PATTERN, "g"))) {
    const name = match?.[2];
    if (name) declarations.push(createScopedFsName(lines, content, match, name));
  }
  for (const match of content.matchAll(new RegExp(RAW_FS_COMBINED_NAMESPACE_IMPORT_PATTERN, "g"))) {
    const name = match?.[1];
    if (name) declarations.push(createScopedFsName(lines, content, match, name));
  }
  for (const match of content.matchAll(new RegExp(RAW_FS_DEFAULT_ALIAS_PATTERN, "g"))) {
    const name = match?.[1];
    if (name) declarations.push(createScopedFsName(lines, content, match, name));
  }
  for (const match of content.matchAll(new RegExp(RAW_FS_PROMISES_ALIAS_PATTERN, "g"))) {
    const name = match?.[1];
    if (name) declarations.push(createScopedFsName(lines, content, match, name));
  }
  for (const declarator of variableDeclarators) {
    const match = RAW_FS_PROMISES_ALIAS_DECLARATOR_PATTERN.exec(declarator.text);
    const name = match?.[1];
    if (name)
      declarations.push(createScopedFsNameFromVariableDeclarator(lines, content, declarator, name));
  }
  for (const match of content.matchAll(new RegExp(RAW_FS_DESTRUCTURED_IMPORT_PATTERN, "g"))) {
    const specifiers = match?.[1] ?? match?.[2] ?? match?.[3];
    if (!specifiers) continue;
    for (const specifier of splitTopLevel(specifiers, ",")) {
      const name = parseDestructuredFsPromisesName(specifier);
      if (name) declarations.push(createScopedFsName(lines, content, match, name));
    }
  }
  for (const match of content.matchAll(
    new RegExp(RAW_FS_COMBINED_DESTRUCTURED_IMPORT_PATTERN, "g"),
  )) {
    const specifiers = match?.[1];
    if (!specifiers) continue;
    for (const specifier of splitTopLevel(specifiers, ",")) {
      const name = parseDestructuredFsPromisesName(specifier);
      if (name) declarations.push(createScopedFsName(lines, content, match, name));
    }
  }
  for (const declaration of findDestructuredFsRuntimeDeclarations(content)) {
    for (const specifier of splitTopLevel(declaration.specifiers, ",")) {
      const name = parseDestructuredFsPromisesName(specifier);
      if (name) {
        declarations.push(
          createScopedFsNameFromSource(
            lines,
            content,
            declaration.matchIndex,
            declaration.declaration,
            name,
          ),
        );
      }
    }
  }
  let addedAlias = true;
  while (addedAlias) {
    addedAlias = false;
    const namesByLine = buildScopedNamesByLine(lines, declarations);
    const declarationsByLine = collectNewlyActiveNamesByLine(namesByLine);
    const names = collectNamesFromLines(namesByLine);
    const shadowedByLine = collectShadowedNamesByLine(lines, names, declarationsByLine);
    for (const match of content.matchAll(new RegExp(RAW_FS_NAMESPACE_DESTRUCTURED_PATTERN, "g"))) {
      const specifiers = match?.[1];
      const source = match?.[2];
      if (
        !specifiers ||
        !source ||
        !isNamespaceSourceAvailable(content, match, source, namesByLine, shadowedByLine)
      )
        continue;
      for (const specifier of splitTopLevel(specifiers, ",")) {
        const name = parseDestructuredFsPromisesName(specifier);
        if (name && !hasScopedNameDeclaration(declarations, name, content, match)) {
          declarations.push(createScopedFsName(lines, content, match, name));
          addedAlias = true;
        }
      }
    }
    for (const declarator of variableDeclarators) {
      const objectBinding = parseObjectBindingVariableDeclarator(declarator);
      if (!objectBinding) continue;
      const match = /^\s*=\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\b/.exec(objectBinding.source);
      const source = match?.[1];
      if (
        !source ||
        !isNamespaceSourceAvailableAt(
          content,
          objectBinding.startIndex,
          source,
          namesByLine,
          shadowedByLine,
        )
      )
        continue;
      for (const specifier of splitTopLevel(objectBinding.specifiers, ",")) {
        const name = parseDestructuredFsPromisesName(specifier);
        if (
          name &&
          !hasScopedNameDeclarationAt(declarations, name, content, objectBinding.startIndex)
        ) {
          declarations.push(
            createScopedFsNameFromVariableDeclarator(lines, content, objectBinding, name),
          );
          addedAlias = true;
        }
      }
    }
    for (const match of content.matchAll(
      new RegExp(RAW_FS_NAMESPACE_PROMISES_ALIAS_PATTERN, "g"),
    )) {
      const name = match?.[1];
      const source = match?.[2];
      if (
        name &&
        source &&
        isNamespaceSourceAvailable(content, match, source, namesByLine, shadowedByLine) &&
        !hasScopedNameDeclaration(declarations, name, content, match)
      ) {
        declarations.push(createScopedFsName(lines, content, match, name));
        addedAlias = true;
      }
    }
    for (const declarator of variableDeclarators) {
      const match = RAW_FS_NAMESPACE_PROMISES_ALIAS_DECLARATOR_PATTERN.exec(declarator.text);
      const name = match?.[1];
      const source = match?.[2];
      if (
        name &&
        source &&
        isNamespaceSourceAvailableAt(
          content,
          declarator.startIndex,
          source,
          namesByLine,
          shadowedByLine,
        ) &&
        !hasScopedNameDeclarationAt(declarations, name, content, declarator.startIndex)
      ) {
        declarations.push(
          createScopedFsNameFromVariableDeclarator(lines, content, declarator, name),
        );
        addedAlias = true;
      }
    }
  }
  return buildScopedNamesByLine(lines, declarations);
}

function collectDestructuredFsNamesByLine(
  lines: readonly string[],
  namespaceFsNamesByLine: readonly ReadonlySet<string>[],
) {
  const declarations: ScopedFsName[] = [];
  const content = lines.join("\n");
  const variableDeclarators = findVariableDeclarators(content);
  for (const match of content.matchAll(new RegExp(RAW_FS_DESTRUCTURED_IMPORT_PATTERN, "g"))) {
    const specifiers = match?.[1] ?? match?.[2] ?? match?.[3];
    if (!specifiers) continue;
    for (const specifier of splitTopLevel(specifiers, ",")) {
      for (const name of parseDestructuredFsNames(specifier)) {
        declarations.push(createScopedFsName(lines, content, match, name));
      }
    }
  }
  for (const match of content.matchAll(
    new RegExp(RAW_FS_COMBINED_DESTRUCTURED_IMPORT_PATTERN, "g"),
  )) {
    const specifiers = match?.[1];
    if (!specifiers) continue;
    for (const specifier of splitTopLevel(specifiers, ",")) {
      for (const name of parseDestructuredFsNames(specifier)) {
        declarations.push(createScopedFsName(lines, content, match, name));
      }
    }
  }
  for (const match of content.matchAll(
    new RegExp(RAW_FS_PROMISES_DESTRUCTURED_IMPORT_PATTERN, "g"),
  )) {
    const specifiers = match?.[1];
    if (!specifiers) continue;
    for (const specifier of splitTopLevel(specifiers, ",")) {
      for (const name of parseDestructuredFsNames(specifier)) {
        declarations.push(createScopedFsName(lines, content, match, name));
      }
    }
  }
  for (const declaration of findDestructuredFsRuntimeDeclarations(content)) {
    for (const specifier of splitTopLevel(declaration.specifiers, ",")) {
      for (const name of parseDestructuredFsNames(specifier)) {
        declarations.push(
          createScopedFsNameFromSource(
            lines,
            content,
            declaration.matchIndex,
            declaration.declaration,
            name,
          ),
        );
      }
    }
  }
  const namespaceFsNames = collectNamesFromLines(namespaceFsNamesByLine);
  const namespaceShadowsByLine = collectShadowedNamesByLine(
    lines,
    namespaceFsNames,
    collectNewlyActiveNamesByLine(namespaceFsNamesByLine),
  );
  for (const match of content.matchAll(new RegExp(RAW_FS_MODULE_MEMBER_ALIAS_PATTERN, "g"))) {
    const name = match?.[1];
    if (name) declarations.push(createScopedFsName(lines, content, match, name));
  }
  for (const declarator of variableDeclarators) {
    const match = RAW_FS_MODULE_MEMBER_ALIAS_DECLARATOR_PATTERN.exec(declarator.text);
    const name = match?.[1];
    if (name)
      declarations.push(createScopedFsNameFromVariableDeclarator(lines, content, declarator, name));
  }
  for (const match of content.matchAll(new RegExp(RAW_FS_NAMESPACE_MEMBER_ALIAS_PATTERN, "g"))) {
    const name = match?.[1];
    const source = match?.[2];
    if (
      name &&
      source &&
      isNamespaceSourceAvailable(
        content,
        match,
        source,
        namespaceFsNamesByLine,
        namespaceShadowsByLine,
      )
    ) {
      declarations.push(createScopedFsName(lines, content, match, name));
    }
  }
  for (const declarator of variableDeclarators) {
    const match = RAW_FS_NAMESPACE_MEMBER_ALIAS_DECLARATOR_PATTERN.exec(declarator.text);
    const name = match?.[1];
    const source = match?.[2];
    if (
      name &&
      source &&
      isNamespaceSourceAvailableAt(
        content,
        declarator.startIndex,
        source,
        namespaceFsNamesByLine,
        namespaceShadowsByLine,
      )
    ) {
      declarations.push(createScopedFsNameFromVariableDeclarator(lines, content, declarator, name));
    }
  }
  for (const declaration of findRawFsDefaultParameterHelperDeclarations(
    content,
    namespaceFsNamesByLine,
    namespaceShadowsByLine,
  )) {
    declarations.push(
      createScopedFsNameFromSource(
        lines,
        content,
        declaration.matchIndex,
        declaration.declaration,
        declaration.name,
      ),
    );
  }
  for (const match of content.matchAll(
    new RegExp(RAW_FS_NAMESPACE_PROMISES_DESTRUCTURED_PATTERN, "g"),
  )) {
    const specifiers = match?.[1];
    const source = match?.[2];
    if (
      !specifiers ||
      !source ||
      !isNamespaceSourceAvailable(
        content,
        match,
        source,
        namespaceFsNamesByLine,
        namespaceShadowsByLine,
      )
    )
      continue;
    for (const specifier of splitTopLevel(specifiers, ",")) {
      for (const name of parseDestructuredFsNames(specifier)) {
        declarations.push(createScopedFsName(lines, content, match, name));
      }
    }
  }
  for (const declarator of variableDeclarators) {
    const objectBinding = parseObjectBindingVariableDeclarator(declarator);
    if (!objectBinding) continue;
    const match = /^\s*=\s*([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*promises\b/.exec(
      objectBinding.source,
    );
    const source = match?.[1];
    if (
      !source ||
      !isNamespaceSourceAvailableAt(
        content,
        objectBinding.startIndex,
        source,
        namespaceFsNamesByLine,
        namespaceShadowsByLine,
      )
    )
      continue;
    for (const specifier of splitTopLevel(objectBinding.specifiers, ",")) {
      for (const name of parseDestructuredFsNames(specifier)) {
        declarations.push(
          createScopedFsNameFromVariableDeclarator(lines, content, objectBinding, name),
        );
      }
    }
  }
  for (const match of content.matchAll(new RegExp(RAW_FS_NAMESPACE_DESTRUCTURED_PATTERN, "g"))) {
    const specifiers = match?.[1];
    const source = match?.[2];
    if (
      !specifiers ||
      !source ||
      !isNamespaceSourceAvailable(
        content,
        match,
        source,
        namespaceFsNamesByLine,
        namespaceShadowsByLine,
      )
    )
      continue;
    for (const specifier of splitTopLevel(specifiers, ",")) {
      for (const name of parseDestructuredFsNames(specifier)) {
        declarations.push(createScopedFsName(lines, content, match, name));
      }
    }
  }
  for (const declarator of variableDeclarators) {
    const objectBinding = parseObjectBindingVariableDeclarator(declarator);
    if (!objectBinding) continue;
    const match = /^\s*=\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\b/.exec(objectBinding.source);
    const source = match?.[1];
    if (
      !source ||
      !isNamespaceSourceAvailableAt(
        content,
        objectBinding.startIndex,
        source,
        namespaceFsNamesByLine,
        namespaceShadowsByLine,
      )
    )
      continue;
    for (const specifier of splitTopLevel(objectBinding.specifiers, ",")) {
      for (const name of parseDestructuredFsNames(specifier)) {
        declarations.push(
          createScopedFsNameFromVariableDeclarator(lines, content, objectBinding, name),
        );
      }
    }
  }
  return buildScopedNamesByLine(lines, declarations);
}

function collectFsSafeNamespaceNamesByLine(lines: readonly string[]) {
  const declarations: ScopedFsName[] = [];
  const content = lines.join("\n");
  const variableDeclarators = findVariableDeclarators(content);
  for (const match of content.matchAll(new RegExp(FS_SAFE_NAMESPACE_PATTERN, "g"))) {
    const name = match?.[1] ?? match?.[2];
    if (name) declarations.push(createScopedFsName(lines, content, match, name));
  }
  for (const declarator of variableDeclarators) {
    const match = FS_SAFE_NAMESPACE_DECLARATOR_PATTERN.exec(declarator.text);
    const name = match?.[1];
    if (name)
      declarations.push(createScopedFsNameFromVariableDeclarator(lines, content, declarator, name));
  }
  return buildScopedNamesByLine(lines, declarations);
}

function collectFsSafeHelperNamesByLine(
  lines: readonly string[],
  fsSafeNamespaceNamesByLine: readonly ReadonlySet<string>[],
) {
  const declarations: ScopedFsName[] = [];
  const content = lines.join("\n");
  const variableDeclarators = findVariableDeclarators(content);
  for (const match of content.matchAll(new RegExp(FS_SAFE_DESTRUCTURED_IMPORT_PATTERN, "g"))) {
    const specifiers = match?.[1] ?? match?.[2];
    if (!specifiers) continue;
    for (const specifier of splitTopLevel(specifiers, ",")) {
      for (const name of parseFsSafeHelperNames(specifier)) {
        declarations.push(createScopedFsName(lines, content, match, name));
      }
    }
  }
  for (const match of content.matchAll(new RegExp(FS_SAFE_COMBINED_NAMED_IMPORT_PATTERN, "g"))) {
    const specifiers = match?.[1];
    if (!specifiers) continue;
    for (const specifier of splitTopLevel(specifiers, ",")) {
      for (const name of parseFsSafeHelperNames(specifier)) {
        declarations.push(createScopedFsName(lines, content, match, name));
      }
    }
  }
  for (const declarator of variableDeclarators) {
    const objectBinding = parseObjectBindingVariableDeclarator(declarator);
    if (!objectBinding) continue;
    if (
      !new RegExp(
        String.raw`^\s*=\s*(?:require\(\s*["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']\s*\)|await\s+import\(\s*["']${FS_SAFE_MODULE_SPECIFIER_PATTERN}["']\s*\))`,
      ).test(objectBinding.source)
    )
      continue;
    for (const specifier of splitTopLevel(objectBinding.specifiers, ",")) {
      for (const name of parseFsSafeHelperNames(specifier)) {
        declarations.push(
          createScopedFsNameFromVariableDeclarator(lines, content, objectBinding, name),
        );
      }
    }
  }
  const fsSafeNamespaceNames = collectNamesFromLines(fsSafeNamespaceNamesByLine);
  const fsSafeNamespaceShadowsByLine = collectShadowedNamesByLine(
    lines,
    fsSafeNamespaceNames,
    collectNewlyActiveNamesByLine(fsSafeNamespaceNamesByLine),
  );
  for (const match of content.matchAll(new RegExp(FS_SAFE_NAMESPACE_DESTRUCTURED_PATTERN, "g"))) {
    const specifiers = match?.[1];
    const source = match?.[2];
    if (
      !specifiers ||
      !source ||
      !isNamespaceSourceAvailable(
        content,
        match,
        source,
        fsSafeNamespaceNamesByLine,
        fsSafeNamespaceShadowsByLine,
      )
    )
      continue;
    for (const specifier of splitTopLevel(specifiers, ",")) {
      for (const name of parseFsSafeHelperNames(specifier)) {
        declarations.push(createScopedFsName(lines, content, match, name));
      }
    }
  }
  for (const declarator of variableDeclarators) {
    const objectBinding = parseObjectBindingVariableDeclarator(declarator);
    if (!objectBinding) continue;
    const match = /^\s*=\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\b/.exec(objectBinding.source);
    const source = match?.[1];
    if (
      !source ||
      !isNamespaceSourceAvailableAt(
        content,
        objectBinding.startIndex,
        source,
        fsSafeNamespaceNamesByLine,
        fsSafeNamespaceShadowsByLine,
      )
    )
      continue;
    for (const specifier of splitTopLevel(objectBinding.specifiers, ",")) {
      for (const name of parseFsSafeHelperNames(specifier)) {
        declarations.push(
          createScopedFsNameFromVariableDeclarator(lines, content, objectBinding, name),
        );
      }
    }
  }
  for (const match of content.matchAll(new RegExp(FS_SAFE_NAMESPACE_MEMBER_ALIAS_PATTERN, "g"))) {
    const name = match?.[1];
    const source = match?.[2];
    if (
      name &&
      source &&
      isNamespaceSourceAvailable(
        content,
        match,
        source,
        fsSafeNamespaceNamesByLine,
        fsSafeNamespaceShadowsByLine,
      )
    ) {
      declarations.push(createScopedFsName(lines, content, match, name));
    }
  }
  for (const declarator of variableDeclarators) {
    const match = FS_SAFE_NAMESPACE_MEMBER_ALIAS_DECLARATOR_PATTERN.exec(declarator.text);
    const name = match?.[1];
    const source = match?.[2];
    if (
      name &&
      source &&
      isNamespaceSourceAvailableAt(
        content,
        declarator.startIndex,
        source,
        fsSafeNamespaceNamesByLine,
        fsSafeNamespaceShadowsByLine,
      )
    ) {
      declarations.push(createScopedFsNameFromVariableDeclarator(lines, content, declarator, name));
    }
  }
  return buildScopedNamesByLine(lines, declarations);
}

function isNamespaceSourceAvailable(
  content: string,
  match: RegExpMatchArray,
  source: string,
  namespaceFsNamesByLine: readonly ReadonlySet<string>[],
  shadowedByLine: readonly ReadonlySet<string>[],
) {
  return isNamespaceSourceAvailableAt(
    content,
    match.index ?? 0,
    source,
    namespaceFsNamesByLine,
    shadowedByLine,
  );
}

function isNamespaceSourceAvailableAt(
  content: string,
  matchIndex: number,
  source: string,
  namespaceFsNamesByLine: readonly ReadonlySet<string>[],
  shadowedByLine: readonly ReadonlySet<string>[],
) {
  const line = lineIndexForContentOffset(content, matchIndex);
  if (!(namespaceFsNamesByLine[line] ?? new Set()).has(source)) return false;
  return !(shadowedByLine[line] ?? new Set()).has(source);
}

function findVariableDeclarators(content: string): VariableDeclarator[] {
  const declarations: VariableDeclarator[] = [];
  const pattern = /\b(?:const|let|var)\b/g;
  let match = pattern.exec(content);
  while (match) {
    const statementStart = match.index;
    const declaratorsStart = pattern.lastIndex;
    const statementEnd = findVariableDeclarationEnd(content, declaratorsStart);
    const declaration = content.slice(statementStart, statementEnd);
    const declaratorList = content.slice(declaratorsStart, statementEnd);
    for (const declarator of splitTopLevelWithOffsets(declaratorList, ",")) {
      const leadingOffset = findFirstNonWhitespaceIndex(declarator.text);
      if (leadingOffset === null) continue;
      declarations.push({
        text: declarator.text.slice(leadingOffset).trimEnd(),
        startIndex: declaratorsStart + declarator.start + leadingOffset,
        statementStartIndex: statementStart,
        declaration,
      });
    }
    pattern.lastIndex = Math.min(content.length, statementEnd + 1);
    match = pattern.exec(content);
  }
  return declarations;
}

function findVariableDeclarationEnd(content: string, startIndex: number) {
  let depth = 0;
  for (let index = startIndex; index < content.length; index += 1) {
    const character = content[index] ?? "";
    if (character === "{" || character === "[" || character === "(") depth += 1;
    if (character === "}" || character === "]" || character === ")") depth -= 1;
    if (character === ";" && depth === 0) return index;
    if ((character === "\n" || character === "\r") && depth === 0) {
      if (shouldEndVariableDeclarationAtLineBreak(content, index)) return index;
    }
  }
  return content.length;
}

function shouldEndVariableDeclarationAtLineBreak(content: string, newlineIndex: number) {
  const previousIndex = findPreviousNonWhitespaceIndex(content, newlineIndex - 1);
  const previous = previousIndex === null ? "" : (content[previousIndex] ?? "");
  if (!previous) return false;
  if (",=?:([{.".includes(previous) || "+-*/%&|^<>!".includes(previous)) return false;

  const nextIndex = findNextNonWhitespaceIndex(content, newlineIndex + 1);
  const next = nextIndex === null ? "" : (content[nextIndex] ?? "");
  return next !== "," && next !== "." && next !== "?" && next !== ":";
}

function findFirstNonWhitespaceIndex(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    if (!/\s/.test(value[index] ?? "")) return index;
  }
  return null;
}

function findPreviousNonWhitespaceIndex(value: string, startIndex: number) {
  for (let index = startIndex; index >= 0; index -= 1) {
    if (!/\s/.test(value[index] ?? "")) return index;
  }
  return null;
}

function parseObjectBindingVariableDeclarator(
  declarator: VariableDeclarator,
): ObjectBindingVariableDeclarator | null {
  if (!declarator.text.startsWith("{")) return null;
  const closeIndex = findMatchingBrace(declarator.text, 0);
  if (closeIndex === null) return null;
  return {
    ...declarator,
    specifiers: declarator.text.slice(1, closeIndex),
    source: declarator.text.slice(closeIndex + 1),
  };
}

function findDestructuredFsRuntimeDeclarations(content: string) {
  const declarations: Array<{ specifiers: string; matchIndex: number; declaration: string }> = [];
  for (const declarator of findVariableDeclarators(content)) {
    const objectBinding = parseObjectBindingVariableDeclarator(declarator);
    if (!objectBinding) continue;
    const sourceMatch =
      /^\s*=\s*(?:require\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)|await\s+import\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\))/.exec(
        objectBinding.source,
      );
    if (sourceMatch) {
      declarations.push({
        specifiers: objectBinding.specifiers,
        matchIndex: objectBinding.statementStartIndex,
        declaration: objectBinding.declaration,
      });
    }
  }
  return declarations;
}

function findRawFsDefaultParameterHelperDeclarations(
  content: string,
  namespaceFsNamesByLine: readonly ReadonlySet<string>[],
  namespaceShadowsByLine: readonly ReadonlySet<string>[],
) {
  const declarations: Array<{ name: string; matchIndex: number; declaration: string }> = [];
  for (const span of findParameterSpans(content)) {
    const parameterText = content.slice(span.openIndex + 1, span.closeIndex);
    for (const parameter of splitTopLevelWithOffsets(parameterText, ",")) {
      const names = new Set<string>();
      const matchIndex = span.openIndex + 1 + parameter.start;
      const line = lineIndexForContentOffset(content, matchIndex);
      const availableNamespaceNames = new Set(namespaceFsNamesByLine[line] ?? new Set());
      for (const name of namespaceShadowsByLine[line] ?? new Set()) {
        availableNamespaceNames.delete(name);
      }
      collectRawFsDefaultHelperBindingNames(parameter.text, names, availableNamespaceNames);
      for (const name of names)
        declarations.push({ name, matchIndex, declaration: parameter.text });
    }
  }
  return declarations;
}

function findParameterSpans(content: string) {
  const spans: ParameterSpan[] = [];
  const addSpan = (openIndex: number, closeIndex: number | null) => {
    if (closeIndex === null) return;
    if (spans.some((span) => span.openIndex === openIndex && span.closeIndex === closeIndex))
      return;
    spans.push({ openIndex, closeIndex });
  };

  for (const match of content.matchAll(/\bfunction\b[^()]*\(/g)) {
    const openIndex = content.indexOf("(", match.index);
    addSpan(openIndex, findMatchingParen(content, openIndex));
  }

  for (const match of content.matchAll(/=>/g)) {
    const arrowIndex = match.index;
    const closeIndex = content.lastIndexOf(")", arrowIndex);
    const openIndex = findMatchingOpenParen(content, closeIndex);
    if (openIndex !== null) addSpan(openIndex, closeIndex);
  }

  for (const span of findMethodParameterSpans(content)) {
    addSpan(span.openIndex, span.closeIndex);
  }

  return spans;
}

function createScopedFsName(
  lines: readonly string[],
  content: string,
  match: RegExpMatchArray,
  name: string,
): ScopedFsName {
  const matchIndex = match.index ?? 0;
  return createScopedFsNameFromSource(lines, content, matchIndex, match[0] ?? "", name);
}

function createScopedFsNameFromVariableDeclarator(
  lines: readonly string[],
  content: string,
  declarator: VariableDeclarator,
  name: string,
): ScopedFsName {
  return createScopedFsNameFromSource(
    lines,
    content,
    declarator.statementStartIndex,
    declarator.declaration,
    name,
  );
}

function createScopedFsNameFromSource(
  lines: readonly string[],
  content: string,
  matchIndex: number,
  declaration: string,
  name: string,
) {
  const line = lineIndexForContentOffset(content, matchIndex);
  const lineStartIndex = content.lastIndexOf("\n", matchIndex - 1) + 1;
  const declarationColumn = matchIndex - lineStartIndex;
  const parameterDefaultScopeEndLine = findParameterDefaultAliasScopeEndLineExclusive(
    lines,
    line,
    declarationColumn,
  );
  return {
    name,
    line,
    endLineExclusive:
      parameterDefaultScopeEndLine ??
      findScopeEndLineExclusive(lines, line, declaration, declarationColumn),
  };
}

function findParameterDefaultAliasScopeEndLineExclusive(
  lines: readonly string[],
  lineIndex: number,
  declarationColumn: number,
) {
  const sameLineScopeEnd = findSameLineParameterDefaultAliasScopeEndLineExclusive(
    lines,
    lineIndex,
    declarationColumn,
  );
  if (sameLineScopeEnd !== null) return sameLineScopeEnd;
  const signatureStartLine = findMultilineParameterListStartLine(lines, lineIndex);
  if (signatureStartLine === null) return null;
  for (let index = lineIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!isMultilineParameterListEnd(line)) continue;
    if (isMultilineArrowExpressionBodyStart(line)) {
      return findMultilineArrowExpressionBodyEndLineExclusive(lines, index);
    }
    return findBlockBodyEndLineExclusive(lines, index);
  }
  return null;
}

function findSameLineParameterDefaultAliasScopeEndLineExclusive(
  lines: readonly string[],
  lineIndex: number,
  declarationColumn: number,
) {
  const line = lines[lineIndex] ?? "";
  const functionMatch = /\bfunction\b[^()]*\(/.exec(line);
  if (functionMatch) {
    const openIndex = line.indexOf("(", functionMatch.index);
    const closeIndex = findMatchingParen(line, openIndex);
    if (closeIndex !== null && declarationColumn > openIndex && declarationColumn < closeIndex) {
      return findBlockBodyEndLineExclusive(lines, lineIndex, closeIndex);
    }
  }

  const arrowIndex = line.indexOf("=>");
  if (arrowIndex >= 0 && declarationColumn < arrowIndex) {
    const closeIndex = line.lastIndexOf(")", arrowIndex);
    const openIndex = findMatchingOpenParen(line, closeIndex);
    if (openIndex !== null && declarationColumn > openIndex && declarationColumn < closeIndex) {
      return (
        findBlockBodyEndLineExclusive(lines, lineIndex, arrowIndex) ??
        findMultilineArrowExpressionBodyEndLineExclusive(lines, lineIndex) ??
        lineIndex + 1
      );
    }
  }

  for (const span of findMethodParameterSpans(line)) {
    if (declarationColumn > span.openIndex && declarationColumn < span.closeIndex) {
      return findBlockBodyEndLineExclusive(lines, lineIndex, span.bodyOpenIndex);
    }
  }

  return null;
}

function findMultilineParameterListStartLine(lines: readonly string[], lineIndex: number) {
  for (let index = lineIndex; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (doesLineStartMultilineParameterList(line)) return index;
    if (isMultilineParameterListEnd(line)) return null;
  }
  return null;
}

function findBlockBodyEndLineExclusive(
  lines: readonly string[],
  lineIndex: number,
  searchStart = 0,
) {
  const line = lines[lineIndex] ?? "";
  const bodyOpenIndex = line.indexOf("{", searchStart);
  if (bodyOpenIndex < 0) return null;
  const sameLineBodyClose = findMatchingBrace(line, bodyOpenIndex);
  if (sameLineBodyClose !== null) return lineIndex + 1;
  const lineDepth = depthBeforeLine(lines, lineIndex);
  const depthAfterLine = Math.max(0, lineDepth + countBraceDelta(line));
  if (depthAfterLine <= lineDepth) return null;
  for (let index = lineIndex + 1; index < lines.length; index += 1) {
    if (depthBeforeLine(lines, index) < depthAfterLine) return index;
  }
  return lines.length;
}

function findScopeEndLineExclusive(
  lines: readonly string[],
  lineIndex: number,
  declaration: string,
  declarationColumn: number,
) {
  if (isModuleScopedDeclaration(declaration)) return lines.length;

  const line = lines[lineIndex] ?? "";
  if (findSameLineDeclarationScopeEnd(line, declarationColumn) !== null) return lineIndex + 1;
  const lineDepth = depthBeforeLine(lines, lineIndex);
  const depthAfterLine = Math.max(0, lineDepth + countBraceDelta(line));

  const scopeDepth = depthAfterLine > lineDepth ? depthAfterLine : lineDepth;
  if (scopeDepth === 0) return lines.length;
  for (let index = lineIndex + 1; index < lines.length; index += 1) {
    if (depthBeforeLine(lines, index) < scopeDepth) return index;
  }
  return lines.length;
}

function isModuleScopedDeclaration(declaration: string) {
  return /^\s*import\s+(?!\()/.test(declaration);
}

function buildScopedNamesByLine(lines: readonly string[], declarations: readonly ScopedFsName[]) {
  return lines.map((_, line) => {
    const names = new Set<string>();
    for (const declaration of declarations) {
      if (line >= declaration.line && line < declaration.endLineExclusive) {
        names.add(declaration.name);
      }
    }
    return names;
  });
}

function collectNamesFromLines(namesByLine: readonly ReadonlySet<string>[]) {
  const names = new Set<string>();
  for (const lineNames of namesByLine) {
    for (const name of lineNames) names.add(name);
  }
  return names;
}

function collectNewlyActiveNamesByLine(namesByLine: readonly ReadonlySet<string>[]) {
  let previousNames = new Set<string>();
  return namesByLine.map((lineNames) => {
    const newNames = new Set<string>();
    for (const name of lineNames) {
      if (!previousNames.has(name)) newNames.add(name);
    }
    previousNames = new Set(lineNames);
    return newNames;
  });
}

function subtractShadowedNamesByLine(
  namesByLine: readonly ReadonlySet<string>[],
  shadowedNamesByLine: readonly ReadonlySet<string>[],
) {
  return namesByLine.map((lineNames, lineIndex) => {
    const names = new Set(lineNames);
    for (const shadowedName of shadowedNamesByLine[lineIndex] ?? new Set()) {
      names.delete(shadowedName);
    }
    return names;
  });
}

function hasScopedNameDeclaration(
  declarations: readonly ScopedFsName[],
  name: string,
  content: string,
  match: RegExpMatchArray,
) {
  return hasScopedNameDeclarationAt(declarations, name, content, match.index ?? 0);
}

function hasScopedNameDeclarationAt(
  declarations: readonly ScopedFsName[],
  name: string,
  content: string,
  matchIndex: number,
) {
  const line = lineIndexForContentOffset(content, matchIndex);
  return declarations.some((declaration) => declaration.name === name && declaration.line === line);
}

function parseDestructuredFsNames(specifier: string) {
  const cleaned = stripTopLevelDefault(specifier.trim()).trim();
  const importAlias = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(cleaned);
  if (importAlias) {
    const importedName = importAlias[1];
    const localName = importAlias[2];
    return importedName && localName && RAW_FS_DESTRUCTURED_NAMES.has(importedName)
      ? [localName]
      : [];
  }

  const requireAlias = /^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/.exec(cleaned);
  if (requireAlias) {
    const importedName = requireAlias[1];
    const localName = requireAlias[2];
    return importedName && localName && RAW_FS_DESTRUCTURED_NAMES.has(importedName)
      ? [localName]
      : [];
  }

  const nestedAlias = /^([A-Za-z_$][\w$]*)\s*:\s*([{[].*)$/.exec(cleaned);
  if (nestedAlias?.[1] === "promises" && nestedAlias[2]) {
    const names = new Set<string>();
    collectFsHelperBindingNames(nestedAlias[2], names);
    return [...names];
  }

  const identifier = /^([A-Za-z_$][\w$]*)$/.exec(cleaned);
  const name = identifier?.[1];
  return name && RAW_FS_DESTRUCTURED_NAMES.has(name) ? [name] : [];
}

function collectFsHelperBindingNames(binding: string, names: Set<string>) {
  const cleaned = stripTopLevelDefault(binding.trim()).trim();
  if (!cleaned) return;
  const withoutRest = cleaned.startsWith("...") ? cleaned.slice(3).trim() : cleaned;
  if (withoutRest.startsWith("{") && withoutRest.endsWith("}")) {
    for (const property of splitTopLevel(withoutRest.slice(1, -1), ",")) {
      collectFsHelperObjectBindingPropertyNames(property, names);
    }
    return;
  }

  const identifier = /^([A-Za-z_$][\w$]*)$/.exec(withoutRest)?.[1];
  if (identifier && RAW_FS_DESTRUCTURED_NAMES.has(identifier)) names.add(identifier);
}

function collectFsHelperObjectBindingPropertyNames(property: string, names: Set<string>) {
  const cleaned = stripTopLevelDefault(property.trim()).trim();
  if (!cleaned) return;
  const withoutRest = cleaned.startsWith("...") ? cleaned.slice(3).trim() : cleaned;
  const colonIndex = findTopLevelCharacter(withoutRest, ":");
  if (colonIndex >= 0) {
    const propertyName = /^([A-Za-z_$][\w$]*)/.exec(withoutRest.slice(0, colonIndex).trim())?.[1];
    const target = withoutRest.slice(colonIndex + 1).trim();
    if (propertyName === "promises") {
      collectFsHelperBindingNames(target, names);
    } else if (propertyName && RAW_FS_DESTRUCTURED_NAMES.has(propertyName)) {
      collectBindingNames(target, names);
    }
    return;
  }

  const identifier = /^([A-Za-z_$][\w$]*)/.exec(withoutRest)?.[1];
  if (identifier && RAW_FS_DESTRUCTURED_NAMES.has(identifier)) names.add(identifier);
}

function parseDestructuredFsPromisesName(specifier: string) {
  const cleaned = stripTopLevelDefault(specifier.trim()).trim();
  const importAlias = /^promises\s+as\s+([A-Za-z_$][\w$]*)$/.exec(cleaned);
  if (importAlias) return importAlias[1] ?? null;

  const requireAlias = /^promises\s*:\s*([A-Za-z_$][\w$]*)$/.exec(cleaned);
  if (requireAlias) return requireAlias[1] ?? null;

  return cleaned === "promises" ? "promises" : null;
}

function parseFsSafeHelperNames(specifier: string) {
  const cleaned = stripTopLevelDefault(specifier.trim()).trim();
  if (!cleaned || cleaned.startsWith("type ")) return [];

  const importAlias = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(cleaned);
  if (importAlias) {
    const importedName = importAlias[1];
    const localName = importAlias[2];
    return importedName && localName && FS_SAFE_HELPER_NAMES.has(importedName) ? [localName] : [];
  }

  const requireAlias = /^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/.exec(cleaned);
  if (requireAlias) {
    const importedName = requireAlias[1];
    const localName = requireAlias[2];
    return importedName && localName && FS_SAFE_HELPER_NAMES.has(importedName) ? [localName] : [];
  }

  const identifier = /^([A-Za-z_$][\w$]*)$/.exec(cleaned);
  const name = identifier?.[1];
  return name && FS_SAFE_HELPER_NAMES.has(name) ? [name] : [];
}

function hasDestructuredFsCall(
  line: string,
  names: ReadonlySet<string>,
  shadowedNames: ReadonlySet<string>,
) {
  for (const name of names) {
    const pattern = new RegExp(`(^|[^.\\w$])${escapeRegExp(name)}\\s*(?:\\?\\.\\s*)?\\(`, "g");
    let match = pattern.exec(line);
    while (match) {
      const usageIndex = match.index + (match[1]?.length ?? 0);
      if (!isNameShadowedAtUsage(line, name, shadowedNames, usageIndex)) return true;
      match = pattern.exec(line);
    }
  }
  return false;
}

function hasNamespaceFsSafeCall(
  line: string,
  names: ReadonlySet<string>,
  shadowedNames: ReadonlySet<string>,
) {
  for (const name of names) {
    const pattern = new RegExp(
      `\\b${escapeRegExp(name)}${OPTIONAL_MEMBER_ACCESS_PATTERN}(?:${FS_SAFE_HELPER_PATTERN})\\b`,
      "g",
    );
    let match = pattern.exec(line);
    while (match) {
      if (!isNameShadowedAtUsage(line, name, shadowedNames, match.index)) return true;
      match = pattern.exec(line);
    }
  }
  return false;
}

function hasNamespaceFsCall(
  line: string,
  names: ReadonlySet<string>,
  shadowedNames: ReadonlySet<string>,
) {
  for (const name of names) {
    const pattern = new RegExp(
      `\\b${escapeRegExp(name)}${OPTIONAL_MEMBER_ACCESS_PATTERN}(?:${RAW_FS_METHOD_PATTERN}|promises${OPTIONAL_MEMBER_ACCESS_PATTERN}(?:${RAW_FS_METHOD_PATTERN}))\\b`,
      "g",
    );
    let match = pattern.exec(line);
    while (match) {
      if (!isNameShadowedAtUsage(line, name, shadowedNames, match.index)) return true;
      match = pattern.exec(line);
    }
  }
  return false;
}

function isNameShadowedAtUsage(
  line: string,
  name: string,
  shadowedNames: ReadonlySet<string>,
  usageIndex: number,
) {
  if (!shadowedNames.has(name)) return false;
  const ranges = findNameShadowRanges(line, name);
  if (ranges.length === 0) return true;
  return ranges.some((range) => usageIndex >= range.start && usageIndex < range.end);
}

function collectShadowedNamesByLine(
  lines: readonly string[],
  names: ReadonlySet<string>,
  fsAliasNamesByLine: readonly ReadonlySet<string>[] = [],
  rawFsDefaultNamespaceNamesByLine: readonly ReadonlySet<string>[] = [],
) {
  const shadowedByLine: Array<Set<string>> = [];
  const activeShadows: Array<{ name: string; depth: number; endLineExclusive?: number }> = [];
  const activeFunctionScopeDepths: number[] = [];
  let pendingParameterLines: string[] | null = null;
  let depth = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const fsAliasNames = fsAliasNamesByLine[lineIndex] ?? new Set();
    const rawFsDefaultNamespaceNames = rawFsDefaultNamespaceNamesByLine[lineIndex] ?? new Set();
    const functionBodyOpenIndices = findFunctionBodyOpenIndices(line);
    const active = new Set<string>();
    for (const shadow of activeShadows) {
      if (
        depth >= shadow.depth &&
        (shadow.endLineExclusive === undefined || lineIndex < shadow.endLineExclusive)
      ) {
        active.add(shadow.name);
      }
    }

    for (const name of names) {
      if (isNameShadowedOnLine(line, name, fsAliasNames, rawFsDefaultNamespaceNames))
        active.add(name);
    }

    let completedParameterShadows: Set<string> | null = null;
    if (pendingParameterLines) {
      pendingParameterLines.push(line);
      const pendingParameterText = pendingParameterLines.join("\n");
      if (isMultilineParameterListEnd(line)) {
        completedParameterShadows = collectParameterShadowedNames(
          pendingParameterText,
          names,
          rawFsDefaultNamespaceNames,
        );
        pendingParameterLines = null;
      } else if (isMultilineParameterListClosed(pendingParameterText)) {
        pendingParameterLines = null;
      }
    }
    if (completedParameterShadows) {
      for (const name of completedParameterShadows) active.add(name);
    }

    shadowedByLine.push(active);

    if (
      !completedParameterShadows &&
      !pendingParameterLines &&
      doesLineStartMultilineParameterList(line)
    ) {
      pendingParameterLines = [line];
    }

    const depthAfterLine = Math.max(0, depth + countBraceDelta(line));
    const shadowIntroductions = [
      ...names,
      ...(completedParameterShadows ? [...completedParameterShadows] : []),
    ].filter((name, index, allNames) => {
      if (allNames.indexOf(name) !== index) return false;
      return (
        isShadowIntroducedOnLine(line, name, fsAliasNames, rawFsDefaultNamespaceNames) ||
        (completedParameterShadows?.has(name) &&
          (depthAfterLine > depth || isMultilineArrowExpressionBodyStart(line)))
      );
    });
    for (const name of shadowIntroductions) {
      if (!shouldPersistShadow(line, name, depth, depthAfterLine, fsAliasNames)) continue;
      const endLineExclusive = completedParameterShadows?.has(name)
        ? findMultilineArrowExpressionBodyEndLineExclusive(lines, lineIndex)
        : null;
      activeShadows.push({
        name,
        depth: shadowDepthForLine(
          line,
          name,
          depth,
          depthAfterLine,
          activeFunctionScopeDepths,
          functionBodyOpenIndices,
        ),
        ...(endLineExclusive === null ? {} : { endLineExclusive }),
      });
    }
    const openedFunctionScopeDepths = functionBodyOpenIndices.map((bodyOpenIndex) =>
      depthAfterColumn(line, bodyOpenIndex, depth),
    );
    depth = depthAfterLine;
    activeFunctionScopeDepths.push(...openedFunctionScopeDepths);
    removeClosedFunctionScopes(activeFunctionScopeDepths, depth);
    for (let index = activeShadows.length - 1; index >= 0; index -= 1) {
      const shadow = activeShadows[index];
      if (
        shadow &&
        (depth < shadow.depth ||
          (shadow.endLineExclusive !== undefined && lineIndex + 1 >= shadow.endLineExclusive))
      ) {
        activeShadows.splice(index, 1);
      }
    }
  }

  return shadowedByLine;
}

function isNameShadowedOnLine(
  line: string,
  name: string,
  fsAliasNames: ReadonlySet<string>,
  rawFsDefaultNamespaceNames: ReadonlySet<string>,
) {
  return (
    isParameterShadowedOnLine(line, name, rawFsDefaultNamespaceNames) ||
    isLocalDeclarationShadow(line, name, fsAliasNames) ||
    isCatchBindingShadow(line, name)
  );
}

function isShadowIntroducedOnLine(
  line: string,
  name: string,
  fsAliasNames: ReadonlySet<string>,
  rawFsDefaultNamespaceNames: ReadonlySet<string>,
) {
  return (
    isParameterShadowedOnLine(line, name, rawFsDefaultNamespaceNames) ||
    isLocalDeclarationShadow(line, name, fsAliasNames) ||
    isCatchBindingShadow(line, name)
  );
}

function isParameterShadowedOnLine(
  line: string,
  name: string,
  rawFsDefaultNamespaceNames: ReadonlySet<string> = new Set(),
) {
  return collectParameterShadowedNames(line, new Set([name]), rawFsDefaultNamespaceNames).has(name);
}

function findNameShadowRanges(line: string, name: string) {
  const ranges: Array<{ start: number; end: number }> = [];
  const parameterRange = findParameterShadowRange(line, name);
  if (parameterRange) ranges.push(parameterRange);
  const variableStart = findVariableDeclarationShadowStartIndex(line, name);
  if (variableStart >= 0)
    ranges.push(
      isVarDeclarationShadow(line, name)
        ? findSameLineVarShadowRange(line, variableStart)
        : findSameLineShadowRange(line, variableStart),
    );
  const destructuredStart = findDestructuredVariableDeclarationShadowStartIndex(line, name);
  if (destructuredStart >= 0)
    ranges.push(
      isVarDestructuredDeclarationShadow(line, name)
        ? findSameLineVarShadowRange(line, destructuredStart)
        : findSameLineShadowRange(line, destructuredStart),
    );
  const functionStart = findFunctionDeclarationShadowStartIndex(line, name);
  if (functionStart >= 0) ranges.push(findSameLineShadowRange(line, functionStart));
  const catchStart = findCatchBindingShadowStartIndex(line, name);
  if (catchStart >= 0) ranges.push(findSameLineCatchShadowRange(line, catchStart));
  return ranges;
}

function findSameLineVarShadowRange(line: string, shadowStart: number) {
  return {
    start: shadowStart,
    end: findSameLineEnclosingFunctionBodyEnd(line, shadowStart) ?? line.length,
  };
}

function findSameLineEnclosingFunctionBodyEnd(line: string, index: number) {
  let enclosingBodyOpenIndex: number | null = null;
  for (const bodyOpenIndex of findFunctionBodyOpenIndices(line)) {
    if (bodyOpenIndex >= index) continue;
    const bodyCloseIndex = findMatchingBrace(line, bodyOpenIndex);
    if (bodyCloseIndex === null || index >= bodyCloseIndex) continue;
    if (enclosingBodyOpenIndex === null || bodyOpenIndex > enclosingBodyOpenIndex) {
      enclosingBodyOpenIndex = bodyOpenIndex;
    }
  }
  if (enclosingBodyOpenIndex === null) return null;
  const bodyCloseIndex = findMatchingBrace(line, enclosingBodyOpenIndex);
  return bodyCloseIndex === null ? null : bodyCloseIndex + 1;
}

function findSameLineShadowRange(line: string, shadowStart: number) {
  const scopeEnd = findSameLineDeclarationScopeEnd(line, shadowStart);
  if (scopeEnd !== null) return { start: shadowStart, end: scopeEnd };
  const statementEnd = findSameLineStatementEnd(line, shadowStart);
  if (statementEnd !== null) return { start: shadowStart, end: statementEnd };
  return { start: shadowStart, end: line.length };
}

function findSameLineDeclarationScopeEnd(line: string, declarationColumn: number) {
  const blockOpenBeforeDeclaration = line.lastIndexOf("{", declarationColumn);
  if (blockOpenBeforeDeclaration >= 0) {
    const closeBraceIndex = findMatchingBrace(line, blockOpenBeforeDeclaration);
    if (closeBraceIndex !== null && closeBraceIndex >= declarationColumn)
      return closeBraceIndex + 1;
  }

  const bodyOpenAfterDeclaration = line.indexOf("{", declarationColumn);
  if (bodyOpenAfterDeclaration < 0) return null;
  const beforeBody = line.slice(0, bodyOpenAfterDeclaration);
  if (!/\bfunction\b/.test(beforeBody) && !/=>\s*$/.test(beforeBody)) return null;
  const closeBraceIndex = findMatchingBrace(line, bodyOpenAfterDeclaration);
  return closeBraceIndex === null ? null : closeBraceIndex + 1;
}

function findSameLineStatementEnd(line: string, startIndex: number) {
  let depth = 0;
  for (let index = startIndex; index < line.length; index += 1) {
    const character = line[index] ?? "";
    if (character === "{" || character === "[" || character === "(") depth += 1;
    if (character === "}" || character === "]" || character === ")") depth -= 1;
    if (character === ";" && depth === 0) return index + 1;
  }
  return null;
}

function findParameterShadowRange(line: string, name: string) {
  if (!isParameterShadowedOnLine(line, name)) return null;

  const functionMatch = /\bfunction\b[^()]*\(/.exec(line);
  if (functionMatch) {
    const openIndex = line.indexOf("(", functionMatch.index);
    const closeIndex = findMatchingParen(line, openIndex);
    if (
      closeIndex !== null &&
      collectBoundParameterListNames(line.slice(openIndex + 1, closeIndex)).has(name)
    ) {
      return {
        start: functionMatch.index,
        end: findSameLineFunctionBodyEnd(line, closeIndex),
      };
    }
  }

  const arrowIndex = line.indexOf("=>");
  if (arrowIndex >= 0) {
    const beforeArrow = line.slice(0, arrowIndex).trimEnd();
    const closeIndex = line.lastIndexOf(")", arrowIndex);
    const openIndex = findMatchingOpenParen(line, closeIndex);
    if (
      openIndex !== null &&
      collectBoundParameterListNames(line.slice(openIndex + 1, closeIndex)).has(name)
    ) {
      return {
        start: openIndex,
        end: findSameLineArrowBodyEnd(line, arrowIndex),
      };
    } else {
      const match = new RegExp(`\\b${escapeRegExp(name)}\\s*$`).exec(beforeArrow);
      if (match) {
        return {
          start: match.index,
          end: findSameLineArrowBodyEnd(line, arrowIndex),
        };
      }
    }
  }

  for (const span of findMethodParameterSpans(line)) {
    if (collectBoundParameterListNames(line.slice(span.openIndex + 1, span.closeIndex)).has(name)) {
      return {
        start: span.signatureStartIndex,
        end: findSameLineMethodBodyEnd(line, span.bodyOpenIndex),
      };
    }
  }

  return null;
}

function findSameLineFunctionBodyEnd(line: string, parameterCloseIndex: number) {
  const bodyOpenIndex = line.indexOf("{", parameterCloseIndex);
  if (bodyOpenIndex < 0) return line.length;
  const bodyCloseIndex = findMatchingBrace(line, bodyOpenIndex);
  return bodyCloseIndex === null ? line.length : bodyCloseIndex + 1;
}

function findSameLineArrowBodyEnd(line: string, arrowIndex: number) {
  const bodyStart = findNextNonWhitespaceIndex(line, arrowIndex + 2);
  if (bodyStart !== null && line[bodyStart] === "{") {
    const bodyCloseIndex = findMatchingBrace(line, bodyStart);
    return bodyCloseIndex === null ? line.length : bodyCloseIndex + 1;
  }
  const semicolonIndex = line.indexOf(";", arrowIndex + 2);
  return semicolonIndex < 0 ? line.length : semicolonIndex + 1;
}

function findSameLineMethodBodyEnd(line: string, bodyOpenIndex: number) {
  const bodyCloseIndex = findMatchingBrace(line, bodyOpenIndex);
  return bodyCloseIndex === null ? line.length : bodyCloseIndex + 1;
}

function findSameLineCatchShadowRange(line: string, catchStart: number) {
  const openIndex = line.indexOf("(", catchStart);
  const closeIndex = findMatchingParen(line, openIndex);
  if (closeIndex !== null) {
    const bodyOpenIndex = findNextNonWhitespaceIndex(line, closeIndex + 1);
    if (bodyOpenIndex !== null && line[bodyOpenIndex] === "{") {
      const bodyCloseIndex = findMatchingBrace(line, bodyOpenIndex);
      if (bodyCloseIndex !== null) return { start: catchStart, end: bodyCloseIndex + 1 };
    }
  }
  return { start: catchStart, end: line.length };
}

function findFunctionBodyOpenIndices(line: string) {
  const indices = new Set<number>();

  for (const match of line.matchAll(/\bfunction\b[^()]*\(/g)) {
    const openIndex = line.indexOf("(", match.index);
    const closeIndex = findMatchingParen(line, openIndex);
    if (closeIndex === null) continue;
    const bodyOpenIndex = findNextNonWhitespaceIndex(line, closeIndex + 1);
    if (bodyOpenIndex !== null && line[bodyOpenIndex] === "{") indices.add(bodyOpenIndex);
  }

  for (const match of line.matchAll(/=>/g)) {
    const bodyOpenIndex = findNextNonWhitespaceIndex(line, match.index + 2);
    if (bodyOpenIndex !== null && line[bodyOpenIndex] === "{") indices.add(bodyOpenIndex);
  }

  for (const span of findMethodParameterSpans(line)) {
    indices.add(span.bodyOpenIndex);
  }

  return [...indices].sort((left, right) => left - right);
}

function depthAfterColumn(line: string, column: number, initialDepth: number) {
  let depth = initialDepth;
  for (let index = 0; index <= column && index < line.length; index += 1) {
    const character = line[index] ?? "";
    if (character === "{") depth += 1;
    if (character === "}") depth = Math.max(0, depth - 1);
  }
  return depth;
}

function removeClosedFunctionScopes(functionScopeDepths: number[], depth: number) {
  for (let index = functionScopeDepths.length - 1; index >= 0; index -= 1) {
    if ((functionScopeDepths[index] ?? 0) > depth) functionScopeDepths.splice(index, 1);
  }
}

function findNextNonWhitespaceIndex(line: string, startIndex: number) {
  for (let index = startIndex; index < line.length; index += 1) {
    if (!/\s/.test(line[index] ?? "")) return index;
  }
  return null;
}

function collectParameterShadowedNames(
  text: string,
  names: ReadonlySet<string>,
  rawFsDefaultNamespaceNames: ReadonlySet<string> = new Set(),
) {
  const boundNames = collectBoundParameterNames(text);
  const rawFsDefaultNames = collectRawFsDefaultParameterNames(text, rawFsDefaultNamespaceNames);
  const shadowed = new Set<string>();
  for (const name of names) {
    if (boundNames.has(name) && !rawFsDefaultNames.has(name)) shadowed.add(name);
  }
  return shadowed;
}

function collectRawFsDefaultParameterNames(
  text: string,
  availableNamespaceNames: ReadonlySet<string>,
) {
  const names = new Set<string>();
  for (const parameterText of extractParameterTexts(text)) {
    for (const parameter of splitTopLevel(parameterText, ",")) {
      collectRawFsDefaultBindingNames(parameter, names, availableNamespaceNames);
    }
  }
  return names;
}

function collectRawFsDefaultBindingNames(
  binding: string,
  names: Set<string>,
  availableNamespaceNames: ReadonlySet<string>,
) {
  const cleaned = stripTopLevelTypeAnnotation(binding.trim()).trim();
  if (!cleaned) return;
  const withoutRest = cleaned.startsWith("...") ? cleaned.slice(3).trim() : cleaned;
  const defaultIndex = findTopLevelCharacter(withoutRest, "=");
  if (defaultIndex >= 0) {
    const target = withoutRest.slice(0, defaultIndex).trim();
    const defaultValue = withoutRest.slice(defaultIndex + 1);
    if (
      RAW_FS_MODULE_PATTERN.test(defaultValue) ||
      hasRawFsHelperReference(defaultValue, availableNamespaceNames)
    ) {
      collectBindingNames(target, names);
      return;
    }
    collectRawFsDefaultBindingNames(target, names, availableNamespaceNames);
    return;
  }

  if (withoutRest.startsWith("{") && withoutRest.endsWith("}")) {
    for (const property of splitTopLevel(withoutRest.slice(1, -1), ",")) {
      collectRawFsDefaultObjectPropertyNames(property, names, availableNamespaceNames);
    }
    return;
  }

  if (withoutRest.startsWith("[") && withoutRest.endsWith("]")) {
    for (const item of splitTopLevel(withoutRest.slice(1, -1), ",")) {
      collectRawFsDefaultBindingNames(item, names, availableNamespaceNames);
    }
  }
}

function collectRawFsDefaultObjectPropertyNames(
  property: string,
  names: Set<string>,
  availableNamespaceNames: ReadonlySet<string>,
) {
  const cleaned = property.trim();
  if (!cleaned) return;
  const withoutRest = cleaned.startsWith("...") ? cleaned.slice(3).trim() : cleaned;
  const colonIndex = findTopLevelCharacter(withoutRest, ":");
  collectRawFsDefaultBindingNames(
    colonIndex >= 0 ? withoutRest.slice(colonIndex + 1) : withoutRest,
    names,
    availableNamespaceNames,
  );
}

function collectRawFsDefaultHelperBindingNames(
  binding: string,
  names: Set<string>,
  availableNamespaceNames: ReadonlySet<string>,
) {
  const cleaned = stripTopLevelTypeAnnotation(binding.trim()).trim();
  if (!cleaned) return;
  const withoutRest = cleaned.startsWith("...") ? cleaned.slice(3).trim() : cleaned;

  if (withoutRest.startsWith("{") && withoutRest.endsWith("}")) {
    for (const property of splitTopLevel(withoutRest.slice(1, -1), ",")) {
      collectRawFsDefaultHelperObjectPropertyNames(property, names, availableNamespaceNames);
    }
    return;
  }

  if (withoutRest.startsWith("[") && withoutRest.endsWith("]")) {
    for (const item of splitTopLevel(withoutRest.slice(1, -1), ",")) {
      collectRawFsDefaultHelperBindingNames(item, names, availableNamespaceNames);
    }
    return;
  }

  const defaultIndex = findTopLevelCharacter(withoutRest, "=");
  if (defaultIndex < 0) return;
  const target = withoutRest.slice(0, defaultIndex).trim();
  const defaultValue = withoutRest.slice(defaultIndex + 1);
  if (hasRawFsHelperReference(defaultValue, availableNamespaceNames))
    collectBindingNames(target, names);
}

function collectRawFsDefaultHelperObjectPropertyNames(
  property: string,
  names: Set<string>,
  availableNamespaceNames: ReadonlySet<string>,
) {
  const cleaned = property.trim();
  if (!cleaned) return;
  const withoutRest = cleaned.startsWith("...") ? cleaned.slice(3).trim() : cleaned;
  const colonIndex = findTopLevelCharacter(withoutRest, ":");
  collectRawFsDefaultHelperBindingNames(
    colonIndex >= 0 ? withoutRest.slice(colonIndex + 1) : withoutRest,
    names,
    availableNamespaceNames,
  );
}

function hasRawFsHelperReference(value: string, availableNamespaceNames: ReadonlySet<string>) {
  const helperPattern = `(?:promises\\s*\\.\\s*)?(?:${RAW_FS_METHOD_PATTERN})\\b`;
  if (RAW_FS_MODULE_PATTERN.test(value) && new RegExp(`\\.\\s*${helperPattern}`).test(value)) {
    return true;
  }
  for (const name of availableNamespaceNames) {
    if (new RegExp(`\\b${escapeRegExp(name)}\\s*\\.\\s*${helperPattern}`).test(value)) return true;
  }
  return false;
}

function collectBoundParameterNames(text: string) {
  const boundNames = new Set<string>();
  for (const parameterText of extractParameterTexts(text)) {
    for (const name of collectBoundParameterListNames(parameterText)) boundNames.add(name);
  }
  return boundNames;
}

function collectBoundParameterListNames(parameterText: string) {
  const boundNames = new Set<string>();
  for (const parameter of splitTopLevel(parameterText, ",")) {
    collectBindingNames(parameter, boundNames);
  }
  return boundNames;
}

function extractParameterTexts(text: string) {
  const parameters: string[] = [];
  const functionMatch = /\bfunction\b[^()]*\(/.exec(text);
  if (functionMatch) {
    const openIndex = text.indexOf("(", functionMatch.index);
    const closeIndex = findMatchingParen(text, openIndex);
    if (closeIndex !== null) parameters.push(text.slice(openIndex + 1, closeIndex));
  }

  const arrowIndex = text.indexOf("=>");
  if (arrowIndex >= 0) {
    const beforeArrow = text.slice(0, arrowIndex).trimEnd();
    const closeIndex = text.lastIndexOf(")", arrowIndex);
    if (closeIndex >= 0) {
      const openIndex = findMatchingOpenParen(text, closeIndex);
      if (openIndex !== null) parameters.push(text.slice(openIndex + 1, closeIndex));
    } else {
      const bareParameter = /([A-Za-z_$][\w$]*)\s*$/.exec(beforeArrow)?.[1];
      if (bareParameter) parameters.push(bareParameter);
    }
  }

  for (const span of findMethodParameterSpans(text)) {
    parameters.push(text.slice(span.openIndex + 1, span.closeIndex));
  }

  return parameters;
}

function findMethodParameterSpans(text: string) {
  const spans: Array<{
    signatureStartIndex: number;
    openIndex: number;
    closeIndex: number;
    bodyOpenIndex: number;
  }> = [];
  for (let openIndex = 0; openIndex < text.length; openIndex += 1) {
    if (text[openIndex] !== "(") continue;
    const signatureStartIndex = findMethodSignatureStartIndex(text, openIndex);
    if (signatureStartIndex === null) continue;
    const closeIndex = findMatchingParen(text, openIndex);
    if (closeIndex === null) continue;
    const bodyOpenIndex = findMethodBodyOpenIndex(text, closeIndex);
    if (bodyOpenIndex === null) continue;
    spans.push({ signatureStartIndex, openIndex, closeIndex, bodyOpenIndex });
  }
  return spans;
}

function findMethodSignatureStartIndex(text: string, openIndex: number) {
  const prefix = text.slice(0, openIndex);
  const segmentStart = findMethodSignatureSegmentStart(prefix);
  const segment = prefix.slice(segmentStart);
  const trimmedStart = segment.search(/\S/);
  if (trimmedStart < 0) return null;
  return isMethodSignaturePrefix(segment) ? segmentStart + trimmedStart : null;
}

function findMethodSignatureSegmentStart(prefix: string) {
  let segmentStart = 0;
  for (let index = prefix.length - 1; index >= 0; index -= 1) {
    const character = prefix[index] ?? "";
    if (character === "{" || character === "}" || character === ";" || character === ",") {
      segmentStart = index + 1;
      break;
    }
  }
  return segmentStart;
}

function isMethodSignaturePrefix(prefix: string) {
  const trimmed = prefix.trim();
  if (!trimmed || trimmed.includes("=") || trimmed.includes("=>")) return false;
  if (/\bfunction\b/.test(trimmed)) return false;
  if (/^(?:if|for|while|switch|catch|with|return|throw|new)\b/.test(trimmed)) return false;
  return /^(?:(?:public|private|protected|static|readonly|abstract|override|async|accessor|get|set)\s+)*(?:\*\s*)?(?:(?:#?[A-Za-z_$][\w$]*\??)(?:\s*<[^<>\n]*>)?|["'][^"'\n]+["']|\[[^\]\n]+\])$/.test(
    trimmed,
  );
}

function findMethodBodyOpenIndex(text: string, closeIndex: number) {
  const suffix = text.slice(closeIndex + 1);
  const match = /^\s*(?::[^;=]*)?\s*\{/.exec(suffix);
  return match ? closeIndex + 1 + match[0].lastIndexOf("{") : null;
}

function collectBindingNames(binding: string, names: Set<string>) {
  const cleaned = stripTopLevelTypeAnnotation(stripTopLevelDefault(binding.trim()).trim()).trim();
  if (!cleaned) return;
  const withoutRest = cleaned.startsWith("...") ? cleaned.slice(3).trim() : cleaned;
  if (withoutRest.startsWith("{") && withoutRest.endsWith("}")) {
    collectObjectBindingNames(withoutRest.slice(1, -1), names);
    return;
  }
  if (withoutRest.startsWith("[") && withoutRest.endsWith("]")) {
    for (const item of splitTopLevel(withoutRest.slice(1, -1), ",")) {
      collectBindingNames(item, names);
    }
    return;
  }

  const identifier = /^([A-Za-z_$][\w$]*)/.exec(withoutRest)?.[1];
  if (identifier) names.add(identifier);
}

function stripTopLevelTypeAnnotation(value: string) {
  if (!value) return value;
  const withoutRest = value.startsWith("...") ? value.slice(3).trimStart() : value;
  const restPrefix = value.slice(0, value.length - withoutRest.length);
  if (withoutRest.startsWith("{") || withoutRest.startsWith("[")) {
    const closeIndex =
      withoutRest[0] === "{"
        ? findMatchingBrace(withoutRest, 0)
        : findMatchingBracket(withoutRest, 0);
    if (closeIndex !== null) {
      const suffix = withoutRest.slice(closeIndex + 1).trimStart();
      if (suffix.startsWith(":")) return restPrefix + withoutRest.slice(0, closeIndex + 1);
    }
    return value;
  }

  const typeIndex = findTopLevelCharacter(withoutRest, ":");
  return typeIndex >= 0 ? restPrefix + withoutRest.slice(0, typeIndex) : value;
}

function collectObjectBindingNames(binding: string, names: Set<string>) {
  for (const property of splitTopLevel(binding, ",")) {
    const cleaned = stripTopLevelDefault(property.trim()).trim();
    if (!cleaned) continue;
    const withoutRest = cleaned.startsWith("...") ? cleaned.slice(3).trim() : cleaned;
    const colonIndex = findTopLevelCharacter(withoutRest, ":");
    if (colonIndex >= 0) {
      collectBindingNames(withoutRest.slice(colonIndex + 1), names);
      continue;
    }
    const identifier = /^([A-Za-z_$][\w$]*)/.exec(withoutRest)?.[1];
    if (identifier) names.add(identifier);
  }
}

function splitTopLevel(value: string, delimiter: ",") {
  const parts: string[] = [];
  let partStart = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (character === "{" || character === "[" || character === "(") depth += 1;
    if (character === "}" || character === "]" || character === ")") depth -= 1;
    if (character === delimiter && depth === 0) {
      parts.push(value.slice(partStart, index));
      partStart = index + 1;
    }
  }
  parts.push(value.slice(partStart));
  return parts;
}

function splitTopLevelWithOffsets(value: string, delimiter: ",") {
  const parts: Array<{ text: string; start: number }> = [];
  let partStart = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (character === "{" || character === "[" || character === "(") depth += 1;
    if (character === "}" || character === "]" || character === ")") depth -= 1;
    if (character === delimiter && depth === 0) {
      parts.push({ text: value.slice(partStart, index), start: partStart });
      partStart = index + 1;
    }
  }
  parts.push({ text: value.slice(partStart), start: partStart });
  return parts;
}

function stripTopLevelDefault(value: string) {
  const defaultIndex = findTopLevelCharacter(value, "=");
  return defaultIndex >= 0 ? value.slice(0, defaultIndex) : value;
}

function findTopLevelCharacter(value: string, target: ":" | "=") {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (character === "{" || character === "[" || character === "(") depth += 1;
    if (character === "}" || character === "]" || character === ")") depth -= 1;
    if (character === target && depth === 0) return index;
  }
  return -1;
}

function findMatchingParen(value: string, openIndex: number) {
  if (openIndex < 0) return null;
  let depth = 0;
  for (let index = openIndex; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function findMatchingOpenParen(value: string, closeIndex: number) {
  if (closeIndex < 0) return null;
  let depth = 0;
  for (let index = closeIndex; index >= 0; index -= 1) {
    const character = value[index] ?? "";
    if (character === ")") depth += 1;
    if (character === "(") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function findMatchingBrace(value: string, openIndex: number) {
  if (openIndex < 0) return null;
  let depth = 0;
  for (let index = openIndex; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function findMatchingBracket(value: string, openIndex: number) {
  if (openIndex < 0) return null;
  let depth = 0;
  for (let index = openIndex; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (character === "[") depth += 1;
    if (character === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function doesLineStartMultilineParameterList(line: string) {
  return (
    /\bfunction\b[^()]*\([^)]*$/.test(line) ||
    /=\s*(?:async\s*)?\([^)]*$/.test(line) ||
    /^\s*\([^)]*$/.test(line) ||
    doesLineStartMethodParameterList(line)
  );
}

function doesLineStartMethodParameterList(line: string) {
  const openIndex = line.lastIndexOf("(");
  if (openIndex < 0 || line.slice(openIndex + 1).includes(")")) return false;
  return findMethodSignatureStartIndex(line, openIndex) !== null;
}

function isMultilineParameterListEnd(line: string) {
  return /\)\s*(?::.*)?\s*(?:=>|\{)/.test(line);
}

function isMultilineParameterListClosed(text: string) {
  const openIndex = text.indexOf("(");
  return openIndex >= 0 && findMatchingParen(text, openIndex) !== null;
}

function isMultilineArrowExpressionBodyStart(line: string) {
  return /\)\s*(?::.*)?\s*=>\s*$/.test(line);
}

function findMultilineArrowExpressionBodyEndLineExclusive(
  lines: readonly string[],
  lineIndex: number,
) {
  const line = lines[lineIndex] ?? "";
  if (!isMultilineArrowExpressionBodyStart(line)) return null;
  let expressionStarted = false;
  let depth = 0;
  for (let index = lineIndex + 1; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? "").trim();
    if (!trimmed) continue;
    expressionStarted = true;
    depth = Math.max(0, depth + countExpressionDelimiterDelta(trimmed));
    if (depth > 0 || isLineContinuingArrowExpression(trimmed)) continue;
    return index + 1;
  }
  return expressionStarted ? lines.length : lineIndex + 1;
}

function isLineContinuingArrowExpression(trimmedLine: string) {
  return /(?:[?:.,]|&&|\|\||[+\-*/%&|^])$/.test(trimmedLine);
}

function countExpressionDelimiterDelta(line: string) {
  let delta = 0;
  for (const character of line) {
    if (character === "{" || character === "[" || character === "(") delta += 1;
    if (character === "}" || character === "]" || character === ")") delta -= 1;
  }
  return delta;
}

function isLocalDeclarationShadow(line: string, name: string, fsAliasNames: ReadonlySet<string>) {
  if (fsAliasNames.has(name)) return false;
  return (
    isVariableDeclarationShadow(line, name) ||
    isDestructuredVariableDeclarationShadow(line, name) ||
    isFunctionDeclarationShadow(line, name)
  );
}

function shouldPersistShadow(
  line: string,
  name: string,
  depth: number,
  depthAfterLine: number,
  fsAliasNames: ReadonlySet<string>,
) {
  if (
    !isFunctionDeclarationShadow(line, name) &&
    isLocalDeclarationShadow(line, name, fsAliasNames) &&
    !isVarDeclarationShadow(line, name) &&
    !isVarDestructuredDeclarationShadow(line, name) &&
    isSameLineBlockScopedLocalShadow(line, name)
  )
    return false;
  if (isParameterShadowedOnLine(line, name) && depthAfterLine <= depth) return false;
  return true;
}

function isSameLineBlockScopedLocalShadow(line: string, name: string) {
  const starts = [
    findVariableDeclarationShadowStartIndex(line, name),
    findDestructuredVariableDeclarationShadowStartIndex(line, name),
  ];
  return starts.some(
    (start) => start >= 0 && findSameLineDeclarationScopeEnd(line, start) !== null,
  );
}

function shadowDepthForLine(
  line: string,
  name: string,
  depth: number,
  depthAfterLine: number,
  activeFunctionScopeDepths: readonly number[],
  functionBodyOpenIndices: readonly number[],
) {
  if (isFunctionDeclarationShadow(line, name)) return depth;
  if (isVarDeclarationShadow(line, name) || isVarDestructuredDeclarationShadow(line, name)) {
    return varShadowDepthForLine(
      line,
      name,
      depth,
      activeFunctionScopeDepths,
      functionBodyOpenIndices,
    );
  }
  return depthAfterLine > depth ? depthAfterLine : depth;
}

function varShadowDepthForLine(
  line: string,
  name: string,
  depth: number,
  activeFunctionScopeDepths: readonly number[],
  functionBodyOpenIndices: readonly number[],
) {
  const declarationStart = Math.max(
    findVariableDeclarationShadowStartIndex(line, name, "var"),
    findDestructuredVariableDeclarationShadowStartIndex(line, name, "var"),
  );
  const sameLineFunctionScopeDepths = functionBodyOpenIndices
    .filter((bodyOpenIndex) => bodyOpenIndex < declarationStart)
    .map((bodyOpenIndex) => depthAfterColumn(line, bodyOpenIndex, depth));
  const functionScopeDepths = [...activeFunctionScopeDepths, ...sameLineFunctionScopeDepths];
  return functionScopeDepths.at(-1) ?? 0;
}

function isVariableDeclarationShadow(line: string, name: string) {
  return findVariableDeclarationShadowStartIndex(line, name) >= 0;
}

function isDestructuredVariableDeclarationShadow(line: string, name: string) {
  return findDestructuredVariableDeclarationShadowStartIndex(line, name) >= 0;
}

function isFunctionDeclarationShadow(line: string, name: string) {
  return findFunctionDeclarationShadowStartIndex(line, name) >= 0;
}

function isCatchBindingShadow(line: string, name: string) {
  return findCatchBindingShadowStartIndex(line, name) >= 0;
}

function isVarDeclarationShadow(line: string, name: string) {
  return findVariableDeclarationShadowStartIndex(line, name, "var") >= 0;
}

function isVarDestructuredDeclarationShadow(line: string, name: string) {
  return findDestructuredVariableDeclarationShadowStartIndex(line, name, "var") >= 0;
}

function findVariableDeclarationShadowStartIndex(
  line: string,
  name: string,
  kind?: "const" | "let" | "var",
) {
  for (const declaration of line.matchAll(/\b(const|let|var)\s+/g)) {
    const declarationKind = declaration[1];
    if (kind && declarationKind !== kind) continue;
    const declarationStart = declaration.index;
    const declaratorStart = declarationStart + declaration[0].length;
    const declarationEnd = findSameLineStatementEnd(line, declaratorStart) ?? line.length;
    const declarators = splitTopLevel(line.slice(declaratorStart, declarationEnd), ",");
    let offset = declaratorStart;
    for (const declarator of declarators) {
      const binding = stripTopLevelDefault(declarator).trim();
      if (new RegExp(`^${escapeRegExp(name)}\\b`).test(binding)) {
        const bindingOffset = declarator.indexOf(binding);
        return offset + Math.max(0, bindingOffset);
      }
      offset += declarator.length + 1;
    }
  }
  return -1;
}

function findDestructuredVariableDeclarationShadowStartIndex(
  line: string,
  name: string,
  kind?: "const" | "let" | "var",
) {
  for (const declaration of line.matchAll(/\b(const|let|var)\s*[[{]/g)) {
    const declarationKind = declaration[1];
    if (kind && declarationKind !== kind) continue;
    const openIndex = findDestructuringOpenIndex(line, declaration.index);
    const closeIndex =
      line[openIndex] === "{"
        ? findMatchingBrace(line, openIndex)
        : findMatchingBracket(line, openIndex);
    if (closeIndex === null) continue;
    const boundNames = new Set<string>();
    collectBindingNames(line.slice(openIndex, closeIndex + 1), boundNames);
    if (boundNames.has(name)) return declaration.index;
  }
  return -1;
}

function findDestructuringOpenIndex(line: string, declarationIndex: number) {
  const objectIndex = line.indexOf("{", declarationIndex);
  const arrayIndex = line.indexOf("[", declarationIndex);
  if (objectIndex < 0) return arrayIndex;
  if (arrayIndex < 0) return objectIndex;
  return Math.min(objectIndex, arrayIndex);
}

function findFunctionDeclarationShadowStartIndex(line: string, name: string) {
  return new RegExp(`\\bfunction\\s+${escapeRegExp(name)}\\s*\\(`).exec(line)?.index ?? -1;
}

function findCatchBindingShadowStartIndex(line: string, name: string) {
  for (const match of line.matchAll(/\bcatch\s*\(/g)) {
    const openIndex = line.indexOf("(", match.index);
    const closeIndex = findMatchingParen(line, openIndex);
    if (closeIndex === null) continue;
    const boundNames = new Set<string>();
    collectBindingNames(line.slice(openIndex + 1, closeIndex), boundNames);
    if (boundNames.has(name)) return match.index;
  }
  return -1;
}

function countBraceDelta(line: string) {
  let delta = 0;
  for (const character of line) {
    if (character === "{") delta += 1;
    if (character === "}") delta -= 1;
  }
  return delta;
}

function depthBeforeLine(lines: readonly string[], lineIndex: number) {
  let depth = 0;
  for (let index = 0; index < lineIndex; index += 1) {
    depth = Math.max(0, depth + countBraceDelta(lines[index] ?? ""));
  }
  return depth;
}

function lineIndexForContentOffset(content: string, offset: number) {
  let line = 0;
  for (let index = 0; index < offset; index += 1) {
    if (content[index] === "\n") line += 1;
  }
  return line;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildPackageDryRunFilesystemEvidence(
  findings: readonly PackageDryRunFilesystemFindingLike[],
  options: BuildPackageDryRunFilesystemEvidenceOptions = {},
): PackageDryRunFilesystemEvidence {
  const maxEvidenceItems = normalizePositiveInteger(
    options.maxEvidenceItems,
    DEFAULT_MAX_EVIDENCE_ITEMS,
  );
  const maxEvidenceChars = normalizePositiveInteger(
    options.maxEvidenceChars,
    DEFAULT_MAX_EVIDENCE_CHARS,
  );

  return {
    rawFsUsage: buildEvidenceBucket(
      findings,
      PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.RAW_FS_USAGE,
      maxEvidenceItems,
      maxEvidenceChars,
    ),
    fsSafeUsage: buildEvidenceBucket(
      findings,
      PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.FS_SAFE_USAGE,
      maxEvidenceItems,
      maxEvidenceChars,
    ),
  };
}

function createPackageDryRunFilesystemEvidenceAccumulator(): PackageDryRunFilesystemEvidenceAccumulator {
  return {
    rawFsUsage: {
      reasonCode: PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.RAW_FS_USAGE,
      totalCount: 0,
      findings: [],
    },
    fsSafeUsage: {
      reasonCode: PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.FS_SAFE_USAGE,
      totalCount: 0,
      findings: [],
    },
  };
}

function recordPackageDryRunFilesystemFinding(
  accumulator: PackageDryRunFilesystemEvidenceAccumulator,
  finding: PackageDryRunFilesystemFindingLike,
  maxEvidenceItems: number,
) {
  const bucket =
    finding.code === PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.RAW_FS_USAGE
      ? accumulator.rawFsUsage
      : finding.code === PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.FS_SAFE_USAGE
        ? accumulator.fsSafeUsage
        : null;
  if (bucket === null) return;
  bucket.totalCount += 1;
  insertBoundedFinding(bucket.findings, finding, maxEvidenceItems);
}

function insertBoundedFinding(
  findings: PackageDryRunFilesystemFindingLike[],
  finding: PackageDryRunFilesystemFindingLike,
  maxEvidenceItems: number,
) {
  if (findings.length < maxEvidenceItems) {
    findings.push(finding);
    findings.sort(compareFindings);
    return;
  }

  const lastFinding = findings.at(-1);
  if (lastFinding && compareFindings(finding, lastFinding) < 0) {
    findings[findings.length - 1] = finding;
    findings.sort(compareFindings);
  }
}

function buildPackageDryRunFilesystemEvidenceFromAccumulator(
  accumulator: PackageDryRunFilesystemEvidenceAccumulator,
  options: BuildPackageDryRunFilesystemEvidenceOptions = {},
): PackageDryRunFilesystemEvidence {
  const maxEvidenceChars = normalizePositiveInteger(
    options.maxEvidenceChars,
    DEFAULT_MAX_EVIDENCE_CHARS,
  );
  return {
    rawFsUsage: buildEvidenceBucketFromAccumulator(accumulator.rawFsUsage, maxEvidenceChars),
    fsSafeUsage: buildEvidenceBucketFromAccumulator(accumulator.fsSafeUsage, maxEvidenceChars),
  };
}

function buildEvidenceBucketFromAccumulator(
  accumulator: PackageDryRunFilesystemBucketAccumulator,
  maxEvidenceChars: number,
): PackageDryRunFilesystemEvidenceBucket {
  const evidence = accumulator.findings.map((finding) =>
    toEvidenceItem(finding, accumulator.reasonCode, maxEvidenceChars),
  );
  return {
    reasonCode: accumulator.reasonCode,
    totalCount: accumulator.totalCount,
    returnedCount: evidence.length,
    omittedCount: Math.max(0, accumulator.totalCount - evidence.length),
    truncatedEvidenceCount: evidence.filter((item) => item.evidenceTruncated).length,
    evidence,
  };
}

function buildEvidenceBucket(
  findings: readonly PackageDryRunFilesystemFindingLike[],
  reasonCode: PackageDryRunFilesystemReasonCode,
  maxEvidenceItems: number,
  maxEvidenceChars: number,
): PackageDryRunFilesystemEvidenceBucket {
  const matchingFindings = findings
    .filter((finding) => finding.code === reasonCode)
    .sort(compareFindings);
  const evidence = matchingFindings
    .slice(0, maxEvidenceItems)
    .map((finding) => toEvidenceItem(finding, reasonCode, maxEvidenceChars));

  return {
    reasonCode,
    totalCount: matchingFindings.length,
    returnedCount: evidence.length,
    omittedCount: Math.max(0, matchingFindings.length - evidence.length),
    truncatedEvidenceCount: evidence.filter((item) => item.evidenceTruncated).length,
    evidence,
  };
}

function toEvidenceItem(
  finding: PackageDryRunFilesystemFindingLike,
  reasonCode: PackageDryRunFilesystemReasonCode,
  maxEvidenceChars: number,
): PackageDryRunFilesystemEvidenceItem {
  const truncated = truncateEvidence(finding.evidence, maxEvidenceChars);
  return {
    code: reasonCode,
    severity: finding.severity,
    file: finding.file,
    line: finding.line,
    message: finding.message,
    evidence: truncated.value,
    evidenceTruncated: truncated.truncated,
  };
}

function truncateEvidence(evidence: string, maxEvidenceChars: number) {
  if (evidence.length <= maxEvidenceChars) return { value: evidence, truncated: false };
  if (maxEvidenceChars <= ELLIPSIS.length) {
    return { value: ELLIPSIS.slice(0, maxEvidenceChars), truncated: true };
  }
  return {
    value: `${evidence.slice(0, maxEvidenceChars - ELLIPSIS.length)}${ELLIPSIS}`,
    truncated: true,
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) return fallback;
  return value;
}

function compareFindings(
  left: PackageDryRunFilesystemFindingLike,
  right: PackageDryRunFilesystemFindingLike,
) {
  return (
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message) ||
    left.evidence.localeCompare(right.evidence)
  );
}
