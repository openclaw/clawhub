/**
 * Helpers that extract "which env vars does this skill need?" signals out
 * of a `skillVersions.parsed` blob.
 *
 * The Convex schema locks `parsed` to a small set of top-level keys
 * (`frontmatter`, `metadata`, `clawdis`, `moltbot`, `license`), but the
 * actual env-related fields live in *different* sub-paths depending on how
 * the skill was published:
 *
 * | Sub-path                                            | Source                                                   |
 * | --------------------------------------------------- | -------------------------------------------------------- |
 * | `parsed.clawdis.requires.env`                       | `parseClawdisMetadata()` after parsing the clawdis block |
 * | `parsed.clawdis.primaryEnv`                         | same                                                     |
 * | `parsed.clawdis.envVars[]`                          | same                                                     |
 * | `parsed.metadata.{clawdbot,clawdis,openclaw}.config.requiredEnv` | dev-seed / legacy uploads                       |
 * | `parsed.metadata.{clawdbot,clawdis,openclaw}.primaryEnv`         | same                                                     |
 * | `parsed.metadata.{clawdbot,clawdis,openclaw}.envVars`            | same                                                     |
 * | `parsed.frontmatter.requires.env`                   | top-level frontmatter fallback (#522)                    |
 * | `parsed.frontmatter.primaryEnv`                     | top-level frontmatter fallback                           |
 * | `parsed.frontmatter.env`                            | top-level frontmatter fallback                           |
 *
 * These helpers walk all of those locations in priority order and return
 * deduplicated, normalised values. They are pure utility functions: no
 * Convex deps, easy to unit-test.
 */

export type EnvVarDeclaration = {
  name: string;
  required?: boolean;
  description?: string;
};

const METADATA_NAMESPACES = ["clawdbot", "clawdis", "openclaw"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getRecord(source: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(source)) return undefined;
  const value = source[key];
  return isRecord(value) ? value : undefined;
}

function getStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) out.push(item.trim());
  }
  return out;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Yields every metadata namespace block that may carry env declarations.
 * Iterates `parsed.metadata.clawdbot`, `parsed.metadata.clawdis`,
 * `parsed.metadata.openclaw` (skipping non-object values).
 */
function metadataNamespaces(parsed: unknown): Array<Record<string, unknown>> {
  const metadata = getRecord(parsed, "metadata");
  if (!metadata) return [];
  const blocks: Array<Record<string, unknown>> = [];
  for (const ns of METADATA_NAMESPACES) {
    const block = getRecord(metadata, ns);
    if (block) blocks.push(block);
  }
  return blocks;
}

/**
 * Extract the list of required env-var names from `parsed`.
 *
 * Search order (results are merged + deduplicated):
 *   1. `parsed.requires.env`                         — legacy direct key
 *   2. `parsed.clawdis.requires.env`                 — canonical
 *   3. `parsed.metadata.<ns>.requires.env`           — legacy / seed
 *   4. `parsed.metadata.<ns>.config.requiredEnv`     — clawdbot config block (mongo-shell style)
 *   5. `parsed.frontmatter.requires.env`             — top-level fallback (#522)
 */
export function extractRequiresEnvList(parsed: unknown): string[] {
  const all: string[] = [];

  // 1. Direct top-level (older code paths).
  all.push(...getStringList(getRecord(parsed, "requires")?.env));

  // 2. clawdis.requires.env (canonical post-parse).
  all.push(...getStringList(getRecord(getRecord(parsed, "clawdis"), "requires")?.env));

  // 3 + 4. metadata.<ns>.requires.env  AND  metadata.<ns>.config.requiredEnv
  for (const ns of metadataNamespaces(parsed)) {
    all.push(...getStringList(getRecord(ns, "requires")?.env));
    all.push(...getStringList(getRecord(ns, "config")?.requiredEnv));
  }

  // 5. Top-level frontmatter fallback.
  all.push(...getStringList(getRecord(getRecord(parsed, "frontmatter"), "requires")?.env));

  return dedupeStrings(all);
}

/**
 * Extract the primaryEnv string (if any), trying:
 *   1. `parsed.primaryEnv`                  — legacy direct key
 *   2. `parsed.clawdis.primaryEnv`          — canonical
 *   3. `parsed.metadata.<ns>.primaryEnv`    — legacy / seed
 *   4. `parsed.frontmatter.primaryEnv`      — top-level fallback
 */
export function extractPrimaryEnvName(parsed: unknown): string | undefined {
  if (!isRecord(parsed)) return undefined;

  const direct = getString(parsed.primaryEnv);
  if (direct) return direct;

  const fromClawdis = getString(getRecord(parsed, "clawdis")?.primaryEnv);
  if (fromClawdis) return fromClawdis;

  for (const ns of metadataNamespaces(parsed)) {
    const fromMetadata = getString(ns.primaryEnv);
    if (fromMetadata) return fromMetadata;
  }

  return getString(getRecord(parsed, "frontmatter")?.primaryEnv);
}

function normalizeEnvVarItem(item: unknown): EnvVarDeclaration | null {
  // Frontmatter `env: ["FOO", "BAR"]` shorthand → required=true entries.
  if (typeof item === "string") {
    const name = item.trim();
    return name ? { name, required: true } : null;
  }
  if (!isRecord(item)) return null;
  const name = typeof item.name === "string" ? item.name.trim() : "";
  if (!name) return null;
  const entry: EnvVarDeclaration = { name };
  if (typeof item.required === "boolean") entry.required = item.required;
  if (typeof item.description === "string" && item.description.trim()) {
    entry.description = item.description.trim();
  }
  return entry;
}

function collectEnvVarsFromArray(value: unknown, sink: EnvVarDeclaration[]): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    const normalized = normalizeEnvVarItem(item);
    if (normalized) sink.push(normalized);
  }
}

/**
 * Extract structured env-var declarations from `parsed`.
 *
 * Search order (results are merged then deduplicated by `name`,
 * keeping the first occurrence — explicit canonical declarations win
 * over fallback locations):
 *   1. `parsed.envVars`                     — legacy direct key
 *   2. `parsed.clawdis.envVars`             — canonical
 *   3. `parsed.metadata.<ns>.envVars`       — legacy / seed
 *   4. `parsed.frontmatter.env`             — top-level fallback (string[] OR object[])
 */
export function extractEnvVarDeclarations(parsed: unknown): EnvVarDeclaration[] {
  if (!isRecord(parsed)) return [];
  const collected: EnvVarDeclaration[] = [];

  collectEnvVarsFromArray(parsed.envVars, collected);
  collectEnvVarsFromArray(getRecord(parsed, "clawdis")?.envVars, collected);
  for (const ns of metadataNamespaces(parsed)) {
    collectEnvVarsFromArray(ns.envVars, collected);
  }
  collectEnvVarsFromArray(getRecord(parsed, "frontmatter")?.env, collected);

  // Dedupe by name, keeping the first occurrence.
  const seen = new Set<string>();
  const out: EnvVarDeclaration[] = [];
  for (const entry of collected) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    out.push(entry);
  }
  return out;
}

/**
 * Tri-input check: does `parsed` declare *any* required env signal?
 * Equivalent to "does the frontmatter make it obvious the user must
 * supply a credential?" — used as the cheap, deterministic short-circuit
 * inside the apiKeyRequired evaluator.
 */
export function hasRequiredEnvSignal(parsed: unknown): boolean {
  if (extractRequiresEnvList(parsed).length > 0) return true;
  if (extractPrimaryEnvName(parsed)) return true;
  return extractEnvVarDeclarations(parsed).some((entry) => entry.required === true);
}
