export const PACKAGE_FILESYSTEM_EVIDENCE_CODES = {
  RAW_FS_USAGE: "info.filesystem.raw_fs_api_usage",
  FS_SAFE_USAGE: "info.filesystem.fs_safe_usage",
} as const;

export type PackageFilesystemEvidenceCode =
  (typeof PACKAGE_FILESYSTEM_EVIDENCE_CODES)[keyof typeof PACKAGE_FILESYSTEM_EVIDENCE_CODES];

export type PackageFilesystemFinding = {
  code: PackageFilesystemEvidenceCode;
  severity: "info" | "warn";
  file: string;
  line: number;
  message: string;
  evidence: string;
};

export type PackageFilesystemContentFile = {
  path: string;
  content: string;
};

export type PackageFilesystemEvidenceItem = PackageFilesystemFinding & {
  evidenceTruncated: boolean;
};

export type PackageFilesystemEvidenceBucket = {
  reasonCode: PackageFilesystemEvidenceCode;
  totalCount: number;
  returnedCount: number;
  omittedCount: number;
  truncatedEvidenceCount: number;
  evidence: PackageFilesystemEvidenceItem[];
};

export type PackageFilesystemEvidence = {
  scannedFileCount: number;
  rawFsUsage: PackageFilesystemEvidenceBucket;
  fsSafeUsage: PackageFilesystemEvidenceBucket;
};

type ScanState = {
  rawFsNamespaces: Set<string>;
  rawFsHelpers: Set<string>;
  fsSafeNamespaces: Set<string>;
  fsSafeHelpers: Set<string>;
};

type NamedSpecifier = {
  imported: string;
  local: string;
};

type PackageFilesystemEvidenceOptions = {
  maxEvidenceItems?: number;
  maxEvidenceChars?: number;
};

const DEFAULT_MAX_EVIDENCE_ITEMS = 20;
const DEFAULT_MAX_EVIDENCE_CHARS = 180;
const ELLIPSIS = "...";
const IDENTIFIER_PATTERN = String.raw`[A-Za-z_$][\w$]*`;
const RAW_FS_MODULE_PATTERN = /["'](?:node:)?fs(?:\/promises)?["']/;
const FS_SAFE_MODULE_PATTERN =
  /["'](?:@openclaw\/fs-safe|openclaw\/plugin-sdk\/(?:security-runtime|file-access-runtime))["']/;
const FS_SAFE_HELPERS = new Set([
  "openFileWithinRoot",
  "readFileWithinRoot",
  "writeFileWithinRoot",
  "appendFileWithinRoot",
  "mkdirWithinRoot",
  "rmWithinRoot",
  "statWithinRoot",
  "resolvePathWithinRoot",
  "resolveDryRunPath",
]);

export function scanPackageFilesystemEvidence(
  files: readonly PackageFilesystemContentFile[],
  options: PackageFilesystemEvidenceOptions = {},
): PackageFilesystemEvidence {
  const findings = files
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path))
    .flatMap((file) => scanPackageFilesystemContent(file.path, file.content));

  return buildPackageFilesystemEvidence(findings, files.length, options);
}

export function scanPackageFilesystemContent(
  path: string,
  content: string,
): PackageFilesystemFinding[] {
  const normalized = normalizeNewlines(content);
  const commentMasked = maskJavaScriptTrivia(normalized, { maskStrings: false });
  const codeMasked = maskJavaScriptTrivia(normalized, { maskStrings: true });
  const sourceLines = normalized.split("\n");
  const commentMaskedLines = commentMasked.split("\n");
  const codeMaskedLines = codeMasked.split("\n");
  const state = createScanState();
  const findings: PackageFilesystemFinding[] = [];

  for (let index = 0; index < sourceLines.length; index += 1) {
    const lineNumber = index + 1;
    const sourceLine = sourceLines[index] ?? "";
    const commentMaskedLine = commentMaskedLines[index] ?? "";
    const codeMaskedLine = codeMaskedLines[index] ?? "";

    if (hasRawFsModuleReference(sourceLine, codeMaskedLine)) {
      findings.push(
        rawFsFinding(path, lineNumber, sourceLine, "Raw Node filesystem module imported."),
      );
      addRawFsBindings(state, sourceLine, commentMaskedLine, codeMaskedLine);
    }

    if (hasFsSafeModuleReference(sourceLine, codeMaskedLine)) {
      findings.push(
        fsSafeFinding(path, lineNumber, sourceLine, "OpenClaw filesystem safety module imported."),
      );
      addFsSafeBindings(state, sourceLine, commentMaskedLine, codeMaskedLine);
    }

    if (hasNamespaceCall(codeMaskedLine, state.rawFsNamespaces)) {
      findings.push(
        rawFsFinding(path, lineNumber, sourceLine, "Raw Node filesystem API call detected."),
      );
    }

    if (hasHelperCall(codeMaskedLine, state.rawFsHelpers)) {
      findings.push(
        rawFsFinding(path, lineNumber, sourceLine, "Raw Node filesystem helper call detected."),
      );
    }

    if (hasNamespaceCall(codeMaskedLine, state.fsSafeNamespaces)) {
      findings.push(
        fsSafeFinding(
          path,
          lineNumber,
          sourceLine,
          "OpenClaw filesystem safety helper call detected.",
        ),
      );
    }

    if (hasHelperCall(codeMaskedLine, state.fsSafeHelpers)) {
      findings.push(
        fsSafeFinding(
          path,
          lineNumber,
          sourceLine,
          "OpenClaw filesystem safety helper call detected.",
        ),
      );
    }
  }

  return findings;
}

function buildPackageFilesystemEvidence(
  findings: readonly PackageFilesystemFinding[],
  scannedFileCount: number,
  options: PackageFilesystemEvidenceOptions,
): PackageFilesystemEvidence {
  const maxEvidenceItems = options.maxEvidenceItems ?? DEFAULT_MAX_EVIDENCE_ITEMS;
  const maxEvidenceChars = options.maxEvidenceChars ?? DEFAULT_MAX_EVIDENCE_CHARS;
  const sorted = findings.slice().sort(compareFindings);

  return {
    scannedFileCount,
    rawFsUsage: buildEvidenceBucket(
      sorted,
      PACKAGE_FILESYSTEM_EVIDENCE_CODES.RAW_FS_USAGE,
      maxEvidenceItems,
      maxEvidenceChars,
    ),
    fsSafeUsage: buildEvidenceBucket(
      sorted,
      PACKAGE_FILESYSTEM_EVIDENCE_CODES.FS_SAFE_USAGE,
      maxEvidenceItems,
      maxEvidenceChars,
    ),
  };
}

function buildEvidenceBucket(
  findings: readonly PackageFilesystemFinding[],
  reasonCode: PackageFilesystemEvidenceCode,
  maxEvidenceItems: number,
  maxEvidenceChars: number,
): PackageFilesystemEvidenceBucket {
  const matching = findings.filter((finding) => finding.code === reasonCode);
  const evidence = matching.slice(0, maxEvidenceItems).map((finding) => {
    const trimmed = truncateEvidence(finding.evidence, maxEvidenceChars);
    return {
      ...finding,
      evidence: trimmed.value,
      evidenceTruncated: trimmed.truncated,
    };
  });

  return {
    reasonCode,
    totalCount: matching.length,
    returnedCount: evidence.length,
    omittedCount: Math.max(0, matching.length - evidence.length),
    truncatedEvidenceCount: evidence.filter((finding) => finding.evidenceTruncated).length,
    evidence,
  };
}

function createScanState(): ScanState {
  return {
    rawFsNamespaces: new Set(["fs"]),
    rawFsHelpers: new Set(),
    fsSafeNamespaces: new Set(),
    fsSafeHelpers: new Set(),
  };
}

function hasRawFsModuleReference(sourceLine: string, codeMaskedLine: string) {
  return RAW_FS_MODULE_PATTERN.test(sourceLine) && hasExecutableModuleSyntax(codeMaskedLine);
}

function hasFsSafeModuleReference(sourceLine: string, codeMaskedLine: string) {
  return FS_SAFE_MODULE_PATTERN.test(sourceLine) && hasExecutableModuleSyntax(codeMaskedLine);
}

function hasExecutableModuleSyntax(codeMaskedLine: string) {
  return (
    /\bimport\s+(?!type\b)/.test(codeMaskedLine) ||
    /\bexport\s+(?!type\b).*?\bfrom\b/.test(codeMaskedLine) ||
    /\brequire\s*\(/.test(codeMaskedLine) ||
    /\bimport\s*\(/.test(codeMaskedLine)
  );
}

function addRawFsBindings(
  state: ScanState,
  sourceLine: string,
  commentMaskedLine: string,
  codeMaskedLine: string,
) {
  for (const namespace of readNamespaceBindings(sourceLine, commentMaskedLine, codeMaskedLine)) {
    state.rawFsNamespaces.add(namespace);
  }
  for (const specifier of readNamedSpecifiers(sourceLine, commentMaskedLine, codeMaskedLine)) {
    if (specifier.imported === "default" || specifier.imported === "promises") {
      state.rawFsNamespaces.add(specifier.local);
    } else {
      state.rawFsHelpers.add(specifier.local);
    }
  }
}

function addFsSafeBindings(
  state: ScanState,
  sourceLine: string,
  commentMaskedLine: string,
  codeMaskedLine: string,
) {
  for (const namespace of readNamespaceBindings(sourceLine, commentMaskedLine, codeMaskedLine)) {
    state.fsSafeNamespaces.add(namespace);
  }
  for (const specifier of readNamedSpecifiers(sourceLine, commentMaskedLine, codeMaskedLine)) {
    if (specifier.imported === "default") {
      state.fsSafeNamespaces.add(specifier.local);
    } else if (FS_SAFE_HELPERS.has(specifier.imported)) {
      state.fsSafeHelpers.add(specifier.local);
    }
  }
}

function readNamespaceBindings(
  sourceLine: string,
  commentMaskedLine: string,
  codeMaskedLine: string,
): string[] {
  const bindings: string[] = [];
  pushMatch(bindings, sourceLine, /\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\b/);
  pushMatch(bindings, sourceLine, /\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,|\s+from\b)/);
  pushMatch(bindings, sourceLine, /\bimport\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(/);
  pushMatch(bindings, sourceLine, /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(/);
  pushMatch(
    bindings,
    sourceLine,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+import\s*\(/,
  );

  if (/\bimport\s*\(/.test(codeMaskedLine)) {
    pushMatch(bindings, sourceLine, /\b([A-Za-z_$][\w$]*)\s*=\s*await\s+import\s*\(/);
  }

  if (!/\bimport\s+(?!type\b)/.test(codeMaskedLine) && !/\brequire\s*\(/.test(codeMaskedLine)) {
    return bindings;
  }

  const defaultAlias = commentMaskedLine.match(/\bdefault\s+as\s+([A-Za-z_$][\w$]*)/);
  if (defaultAlias?.[1]) bindings.push(defaultAlias[1]);

  return bindings;
}

function readNamedSpecifiers(
  sourceLine: string,
  commentMaskedLine: string,
  codeMaskedLine: string,
): NamedSpecifier[] {
  if (!/\{/.test(codeMaskedLine)) return [];

  const importMatch = sourceLine.match(
    /\bimport\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]+)\}\s+from\b/,
  );
  const exportMatch = sourceLine.match(/\bexport\s+\{([^}]+)\}\s+from\b/);
  const requireMatch = sourceLine.match(/\b(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\s*\(/);
  const dynamicImportMatch = sourceLine.match(
    /\b(?:const|let|var)\s+\{([^}]+)\}\s*=\s*await\s+import\s*\(/,
  );
  const specifierList =
    importMatch?.[1] ?? exportMatch?.[1] ?? requireMatch?.[1] ?? dynamicImportMatch?.[1];

  if (!specifierList || !commentMaskedLine.includes(specifierList)) return [];
  return parseNamedSpecifiers(specifierList);
}

function parseNamedSpecifiers(specifierList: string): NamedSpecifier[] {
  const specifiers: NamedSpecifier[] = [];
  for (const rawSpecifier of specifierList.split(",")) {
    const cleaned = rawSpecifier.trim().replace(/^type\s+/, "");
    if (!cleaned) continue;

    const aliasMatch = cleaned.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (aliasMatch?.[1] && aliasMatch[2]) {
      specifiers.push({ imported: aliasMatch[1], local: aliasMatch[2] });
      continue;
    }

    const destructuredAliasMatch = cleaned.match(/^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/);
    if (destructuredAliasMatch?.[1] && destructuredAliasMatch[2]) {
      specifiers.push({ imported: destructuredAliasMatch[1], local: destructuredAliasMatch[2] });
      continue;
    }

    const directMatch = cleaned.match(/^([A-Za-z_$][\w$]*)$/);
    if (directMatch?.[1]) {
      specifiers.push({ imported: directMatch[1], local: directMatch[1] });
    }
  }
  return specifiers;
}

function hasNamespaceCall(codeMaskedLine: string, namespaces: ReadonlySet<string>) {
  for (const namespace of namespaces) {
    const pattern = new RegExp(
      String.raw`\b${escapeRegExp(namespace)}\s*(?:\?\.|\.)\s*(?:promises\s*(?:\?\.|\.)\s*)?${IDENTIFIER_PATTERN}\s*\(`,
    );
    if (pattern.test(codeMaskedLine)) return true;
  }
  return false;
}

function hasHelperCall(codeMaskedLine: string, helpers: ReadonlySet<string>) {
  for (const helper of helpers) {
    const pattern = new RegExp(String.raw`\b${escapeRegExp(helper)}\s*\(`);
    if (pattern.test(codeMaskedLine)) return true;
  }
  return false;
}

function rawFsFinding(
  file: string,
  line: number,
  sourceLine: string,
  message: string,
): PackageFilesystemFinding {
  return {
    code: PACKAGE_FILESYSTEM_EVIDENCE_CODES.RAW_FS_USAGE,
    severity: "warn",
    file,
    line,
    message,
    evidence: sourceLine.trim(),
  };
}

function fsSafeFinding(
  file: string,
  line: number,
  sourceLine: string,
  message: string,
): PackageFilesystemFinding {
  return {
    code: PACKAGE_FILESYSTEM_EVIDENCE_CODES.FS_SAFE_USAGE,
    severity: "info",
    file,
    line,
    message,
    evidence: sourceLine.trim(),
  };
}

function pushMatch(output: string[], source: string, pattern: RegExp) {
  const match = source.match(pattern);
  if (match?.[1]) output.push(match[1]);
}

function compareFindings(left: PackageFilesystemFinding, right: PackageFilesystemFinding) {
  return (
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.code.localeCompare(right.code) ||
    left.evidence.localeCompare(right.evidence)
  );
}

function truncateEvidence(value: string, maxChars: number) {
  if (value.length <= maxChars) return { value, truncated: false };
  const limit = Math.max(0, maxChars - ELLIPSIS.length);
  return { value: `${value.slice(0, limit)}${ELLIPSIS}`, truncated: true };
}

function normalizeNewlines(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskJavaScriptTrivia(content: string, options: { maskStrings: boolean }) {
  let output = "";
  let mode: "code" | "lineComment" | "blockComment" | "singleQuote" | "doubleQuote" | "template" =
    "code";
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index] ?? "";
    const next = content[index + 1] ?? "";

    if (mode === "lineComment") {
      if (char === "\n") {
        output += "\n";
        mode = "code";
      } else {
        output += " ";
      }
      continue;
    }

    if (mode === "blockComment") {
      if (char === "*" && next === "/") {
        output += "  ";
        index += 1;
        mode = "code";
      } else {
        output += char === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (mode === "singleQuote" || mode === "doubleQuote" || mode === "template") {
      output += options.maskStrings && char !== "\n" ? " " : char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (
        (mode === "singleQuote" && char === "'") ||
        (mode === "doubleQuote" && char === '"') ||
        (mode === "template" && char === "`")
      ) {
        mode = "code";
      }
      continue;
    }

    if (char === "/" && next === "/") {
      output += "  ";
      index += 1;
      mode = "lineComment";
      continue;
    }
    if (char === "/" && next === "*") {
      output += "  ";
      index += 1;
      mode = "blockComment";
      continue;
    }
    if (char === "'") {
      output += options.maskStrings ? " " : char;
      mode = "singleQuote";
      escaped = false;
      continue;
    }
    if (char === '"') {
      output += options.maskStrings ? " " : char;
      mode = "doubleQuote";
      escaped = false;
      continue;
    }
    if (char === "`") {
      output += options.maskStrings ? " " : char;
      mode = "template";
      escaped = false;
      continue;
    }

    output += char;
  }

  return output;
}
