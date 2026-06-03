/**
 * Build the base URL used by MarkdownPreview to resolve relative <img src>
 * values (e.g. `./images/foo.png`) inside a plugin README.
 *
 * Strategy: when a release has source metadata (sourceRepo + a 40-hex
 * sourceCommit), point at the matching `raw.githubusercontent.com` tree.
 * Using the commit SHA — not a branch like `main` — keeps each published
 * package page stable even if the source branch later moves.
 *
 * When a `sourcePath` is supplied (the package directory inside the source
 * repo, e.g. `examples/openclaw-plugin`), it is appended after the commit
 * SHA so that relative README images resolve against the package
 * subdirectory rather than the repo root. This matters for monorepo
 * publishes where the README references `./images/...` next to itself.
 *
 * Returns `undefined` when we can't construct a safe, stable base URL; in
 * that case MarkdownPreview falls back to its legacy behavior of leaving
 * relative sources untouched.
 *
 * `sourceRepo` may be either `owner/repo` (the canonical form) or a full
 * GitHub URL (older publishes stored `source.url` here when `repo` was
 * empty). Both shapes are normalized; non-GitHub hosts are rejected because
 * raw.githubusercontent.com is the only host this URL pattern is valid for
 * and the only host beyond GitHub already in vercel.json's image
 * remotePatterns allow-list relevant to this rewrite.
 *
 * `sourcePath` is path-segmented and per-segment validated against a
 * conservative `[A-Za-z0-9._-]` whitelist. `..` segments and any
 * disallowed character cause the base URL to be rejected so the publish
 * form does not promise that README images will render from the wrong
 * source directory. Missing, empty, or "." source paths still mean repo root.
 */

const COMMIT_SHA = /^[0-9a-f]{40}$/i;
const GITHUB_OWNER_REPO = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)$/;
const PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;

function normalizeOwnerRepo(input: string | undefined | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (GITHUB_OWNER_REPO.test(trimmed)) {
    return trimmed.replace(/\.git$/i, "");
  }

  // Tolerate a full GitHub URL — older publishes may have stored
  // `source.url` in `verification.sourceRepo`.
  try {
    const url = new URL(trimmed);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
    const parts = url.pathname
      .replace(/^\/+/, "")
      .replace(/\.git$/i, "")
      .split("/");
    if (parts.length < 2) return null;
    const ownerRepo = `${parts[0]}/${parts[1]}`;
    return GITHUB_OWNER_REPO.test(ownerRepo) ? ownerRepo : null;
  } catch {
    return null;
  }
}

function normalizeSourcePath(input: string | undefined | null): string | null | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed || trimmed === ".") return undefined;
  // Reject anything that doesn't look like a forward-slash relative path —
  // no protocol-like contents, no backslashes, no whitespace. Leading and
  // trailing slashes are tolerated because `split("/").filter(Boolean)`
  // collapses them; only segment-level shapes need strict validation.
  if (/[\\\s]/.test(trimmed)) return null;
  if (trimmed.includes("://")) return null;
  const segments = trimmed.split("/").filter(Boolean);
  if (segments.length === 0) return undefined;
  for (const segment of segments) {
    if (segment === "." || segment === "..") return null;
    if (!PATH_SEGMENT.test(segment)) return null;
  }
  return segments.join("/");
}

export function buildReadmeAssetBaseUrl(
  sourceRepo: string | undefined | null,
  sourceCommit: string | undefined | null,
  sourcePath?: string | null,
): string | undefined {
  const ownerRepo = normalizeOwnerRepo(sourceRepo);
  if (!ownerRepo) return undefined;
  const commit = sourceCommit?.trim();
  if (!commit || !COMMIT_SHA.test(commit)) return undefined;
  const path = normalizeSourcePath(sourcePath);
  if (path === null) return undefined;
  // Trailing slash is required so `new URL("./images/foo.png", base)`
  // resolves as a directory rather than dropping the last path segment.
  return path
    ? `https://raw.githubusercontent.com/${ownerRepo}/${commit}/${path}/`
    : `https://raw.githubusercontent.com/${ownerRepo}/${commit}/`;
}
