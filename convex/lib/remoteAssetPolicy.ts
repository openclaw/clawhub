import { ConvexError } from "convex/values";

export type RemoteReferenceFindingSeverity = "warn" | "critical";

export type RemoteReferenceFinding = {
  code:
    | "REMOTE_REFERENCE_UNPINNED_GITHUB"
    | "REMOTE_REFERENCE_HASH_MISSING"
    | "REMOTE_REFERENCE_INSECURE_HTTP"
    | "REMOTE_REFERENCE_RAW_IP";
  severity: RemoteReferenceFindingSeverity;
  file: string;
  line: number;
  message: string;
  evidence: string;
};

export type RemoteReference = {
  url: string;
  file: string;
  line: number;
  context: string;
};

export type RemoteAssetPolicyInput = {
  files: Array<{ path: string; content: string }>;
  metadata?: unknown;
};

export type RemoteAssetPolicyOptions = {
  blockingCodes?: RemoteReferenceFinding["code"][];
};

const DEFAULT_BLOCKING_CODES = new Set<RemoteReferenceFinding["code"]>([
  "REMOTE_REFERENCE_UNPINNED_GITHUB",
  "REMOTE_REFERENCE_INSECURE_HTTP",
  "REMOTE_REFERENCE_RAW_IP",
]);

const URL_PATTERN = /\bhttps?:\/\/[^\s"'`<>)\]}]+/gi;
const SHA256_PATTERN = /\bsha256[:=]\s*["']?([a-f0-9]{64})["']?/i;
const RAW_IP_HOST_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;

const TEXT_CONTENT_TYPES = [
  "application/json",
  "application/ld+json",
  "application/manifest+json",
  "application/x-yaml",
  "application/yaml",
  "text/",
];

const TEXT_FILE_EXTENSIONS = [
  ".cjs",
  ".css",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
];

export function isRemoteAssetPolicyTextFile(path: string, contentType?: string) {
  const lowerPath = path.toLowerCase();
  const lowerContentType = contentType?.toLowerCase() ?? "";

  if (TEXT_FILE_EXTENSIONS.some((extension) => lowerPath.endsWith(extension))) {
    return true;
  }

  return TEXT_CONTENT_TYPES.some((prefix) => lowerContentType.startsWith(prefix));
}

function trimUrl(url: string) {
  return url.replace(/[.,;:!?]+$/g, "");
}

function getLineNumber(content: string, index: number) {
  return content.slice(0, index).split("\n").length;
}

function getLineText(content: string, lineNumber: number) {
  return content.split("\n")[lineNumber - 1]?.trim() ?? "";
}

function isLocalOrExampleHost(hostname: string) {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host === "example.com" ||
    host.endsWith(".example.com") ||
    host === "example.org" ||
    host.endsWith(".example.org") ||
    host === "example.net" ||
    host.endsWith(".example.net")
  );
}

function isFullGitCommitRef(ref: string) {
  return /^[a-f0-9]{40}$/i.test(ref);
}

function githubMutableRefFinding(ref: string) {
  const normalized = ref.toLowerCase();
  return (
    normalized === "main" ||
    normalized === "master" ||
    normalized === "develop" ||
    normalized === "dev" ||
    normalized.startsWith("release/") ||
    normalized.startsWith("feature/") ||
    normalized.startsWith("fix/") ||
    normalized.startsWith("hotfix/")
  );
}

function parseGithubBlobRef(url: URL) {
  if (url.hostname.toLowerCase() !== "github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const blobIndex = parts.indexOf("blob");
  if (parts.length < 5 || blobIndex !== 2) return null;
  return parts[3] ?? null;
}

function parseRawGithubRef(url: URL) {
  if (url.hostname.toLowerCase() !== "raw.githubusercontent.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 4) return null;
  return parts[2] ?? null;
}

function isGithubReferenceThatMustBePinned(url: URL) {
  return parseGithubBlobRef(url) ?? parseRawGithubRef(url);
}

function hasNearbySha256(content: string, index: number) {
  const start = Math.max(0, index - 500);
  const end = Math.min(content.length, index + 500);
  return SHA256_PATTERN.test(content.slice(start, end));
}

export function extractExternalReferences(input: RemoteAssetPolicyInput): RemoteReference[] {
  const references: RemoteReference[] = [];

  for (const file of input.files) {
    URL_PATTERN.lastIndex = 0;
    for (const match of file.content.matchAll(URL_PATTERN)) {
      const raw = match[0];
      const index = match.index ?? 0;
      const url = trimUrl(raw);
      const line = getLineNumber(file.content, index);
      references.push({
        url,
        file: file.path,
        line,
        context: getLineText(file.content, line),
      });
    }
  }

  const metadataText =
    input.metadata === undefined
      ? ""
      : JSON.stringify(input.metadata, (_key, value) =>
          typeof value === "bigint" ? String(value) : value,
        );

  if (metadataText) {
    URL_PATTERN.lastIndex = 0;
    for (const match of metadataText.matchAll(URL_PATTERN)) {
      const url = trimUrl(match[0]);
      references.push({
        url,
        file: "<metadata>",
        line: 1,
        context: url,
      });
    }
  }

  return references;
}

export function buildRemoteReferenceFindings(
  input: RemoteAssetPolicyInput,
): RemoteReferenceFinding[] {
  const findings: RemoteReferenceFinding[] = [];

  for (const file of input.files) {
    URL_PATTERN.lastIndex = 0;
    for (const match of file.content.matchAll(URL_PATTERN)) {
      const raw = match[0];
      const index = match.index ?? 0;
      const rawUrl = trimUrl(raw);
      const line = getLineNumber(file.content, index);
      const context = getLineText(file.content, line);

      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        continue;
      }

      const hostname = parsed.hostname.toLowerCase();
      if (isLocalOrExampleHost(hostname)) continue;

      if (parsed.protocol === "http:") {
        findings.push({
          code: "REMOTE_REFERENCE_INSECURE_HTTP",
          severity: "critical",
          file: file.path,
          line,
          message: "Remote asset uses plaintext HTTP.",
          evidence: context,
        });
        continue;
      }

      if (RAW_IP_HOST_PATTERN.test(hostname)) {
        findings.push({
          code: "REMOTE_REFERENCE_RAW_IP",
          severity: "critical",
          file: file.path,
          line,
          message: "Remote asset uses a raw IP address.",
          evidence: context,
        });
      }

      const gitRef = isGithubReferenceThatMustBePinned(parsed);
      if (gitRef && (githubMutableRefFinding(gitRef) || !isFullGitCommitRef(gitRef))) {
        findings.push({
          code: "REMOTE_REFERENCE_UNPINNED_GITHUB",
          severity: "critical",
          file: file.path,
          line,
          message: "GitHub remote asset must use a full 40 character commit hash.",
          evidence: context,
        });
      }

      if (
        parsed.protocol === "https:" &&
        !hasNearbySha256(file.content, index) &&
        !isLocalOrExampleHost(hostname)
      ) {
        findings.push({
          code: "REMOTE_REFERENCE_HASH_MISSING",
          severity: "warn",
          file: file.path,
          line,
          message: "Remote asset should declare a nearby SHA-256 hash.",
          evidence: context,
        });
      }
    }
  }

  return findings;
}

export function assertRemoteAssetPolicy(
  input: RemoteAssetPolicyInput,
  options: RemoteAssetPolicyOptions = {},
) {
  const findings = buildRemoteReferenceFindings(input);
  const blockingCodes = new Set(options.blockingCodes ?? DEFAULT_BLOCKING_CODES);
  const blocking = findings.find(
    (finding) => finding.severity === "critical" && blockingCodes.has(finding.code),
  );
  if (blocking) {
    throw new ConvexError(
      `${blocking.code}: ${blocking.message} (${blocking.file}:${blocking.line})`,
    );
  }
  return findings;
}
