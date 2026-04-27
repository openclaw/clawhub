import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./functions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REGISTRY_ENDPOINTS: Record<SupportedRegistry, string> = {
  pypi: "https://pypi.org/pypi/{name}/json",
  npm: "https://registry.npmjs.org/{name}",
  cargo: "https://crates.io/api/v1/crates/{name}",
};

const REQUEST_TIMEOUT_MS = 8_000;
const INTER_REQUEST_DELAY_MS = 200;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 2_000;

/** Packages that exist -> cache for 30 days. */
const CACHE_TTL_EXISTS_MS = 30 * 24 * 60 * 60 * 1_000;
/** Packages that don't exist -> cache for 7 days. */
const CACHE_TTL_NOT_EXISTS_MS = 7 * 24 * 60 * 60 * 1_000;

/** Abort the entire scan after this many consecutive network failures. */
const CONSECUTIVE_FAILURE_ABORT = 3;

type SupportedRegistry = "pypi" | "npm" | "cargo";

type DepEntry = { name: string; registry: SupportedRegistry; source: string };

// ---------------------------------------------------------------------------
// Dependency file parsers
// ---------------------------------------------------------------------------

/** Recognized dependency file names (lowercased) and their parsers. */
const DEP_FILE_PARSERS: Record<
  string,
  (content: string, path: string) => DepEntry[]
> = {
  "requirements.txt": parseRequirementsTxt,
  "requirements-dev.txt": parseRequirementsTxt,
  "requirements_dev.txt": parseRequirementsTxt,
  "requirements-test.txt": parseRequirementsTxt,
  "requirements_test.txt": parseRequirementsTxt,
  "package.json": parsePackageJson,
  "cargo.toml": parseCargoToml,
  "pyproject.toml": parsePyprojectToml,
};

/**
 * Parse requirements.txt — one package per line.
 * Handles: `requests>=2.0`, `flask==2.3.1`, `numpy`, `package[extra]`,
 *          `-r other.txt` (skip), `# comment` (skip), blank lines.
 */
function parseRequirementsTxt(content: string, path: string): DepEntry[] {
  const entries: DepEntry[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    // Skip direct URL references: `pkg @ git+https://...` or `pkg @ https://...`
    if (/\s@\s/.test(line)) continue;
    // Strip version specifiers, extras, environment markers
    const match = line.match(/^([a-zA-Z0-9_][a-zA-Z0-9._-]*)/);
    if (match) {
      entries.push({
        name: match[1].toLowerCase(),
        registry: "pypi",
        source: path,
      });
    }
  }
  return entries;
}

/** Parse package.json — extract keys from dependencies / devDependencies. */
function parsePackageJson(content: string, path: string): DepEntry[] {
  const entries: DepEntry[] = [];
  try {
    const pkg = JSON.parse(content) as Record<string, unknown>;
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
      const deps = pkg[field];
      if (deps && typeof deps === "object" && !Array.isArray(deps)) {
        for (const name of Object.keys(deps as Record<string, unknown>)) {
          // Skip non-registry version specifiers (local, git, URL, workspace)
          const ver = (deps as Record<string, string>)[name] ?? "";
          const NON_REGISTRY = ["file:", "link:", "git+", "git://", "github:", "bitbucket:", "gist:", "http:", "https://", "workspace:", "npm:"];
          if (NON_REGISTRY.some((p) => ver.startsWith(p))) continue;
          entries.push({ name: name.toLowerCase(), registry: "npm", source: path });
        }
      }
    }
  } catch {
    // Malformed JSON — skip
  }
  return entries;
}

/** Parse Cargo.toml — extract [dependencies] and [dev-dependencies] keys. */
function parseCargoToml(content: string, path: string): DepEntry[] {
  const entries: DepEntry[] = [];
  // Minimal TOML section parser: find [dependencies] / [dev-dependencies]
  // and extract `name = ...` lines until the next section header.
  const lines = content.split("\n");
  let inDepSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) {
      const section = line.replace(/[[\]\s]/g, "").toLowerCase();
      inDepSection =
        section === "dependencies" ||
        section === "dev-dependencies" ||
        section === "build-dependencies";
      continue;
    }
    if (!inDepSection) continue;
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([a-zA-Z0-9_][a-zA-Z0-9_-]*)\s*=/);
    if (match) {
      entries.push({
        name: match[1].toLowerCase().replace(/_/g, "-"),
        registry: "cargo",
        source: path,
      });
    }
  }
  return entries;
}

/**
 * Parse pyproject.toml — extract dependencies from:
 * - PEP 621 array: `dependencies = ["requests>=2.0", ...]`
 * - Poetry table: `[tool.poetry.dependencies]` with `name = "version"` entries
 */
function parsePyprojectToml(content: string, path: string): DepEntry[] {
  const entries: DepEntry[] = [];
  const lines = content.split("\n");
  let inDepArray = false;
  let inPoetryDepTable = false;
  for (const raw of lines) {
    const line = raw.trim();

    // Section header resets state
    if (/^\[.*\]$/.test(line)) {
      inDepArray = false;
      const section = line.replace(/[[\]\s]/g, "").toLowerCase();
      inPoetryDepTable =
        section === "tool.poetry.dependencies" ||
        section === "tool.poetry.dev-dependencies" ||
        section === "tool.poetry.group.dev.dependencies";
      continue;
    }

    // PEP 621 array: `dependencies = [`
    if (/^dependencies\s*=\s*\[/.test(line)) {
      inDepArray = true;
      const inline = line.match(/\[\s*(.*)\s*\]/);
      if (inline) {
        for (const item of extractQuotedStrings(inline[1])) {
          const name = item.match(/^([a-zA-Z0-9_][a-zA-Z0-9._-]*)/);
          if (name) entries.push({ name: name[1].toLowerCase(), registry: "pypi", source: path });
        }
        inDepArray = false;
      }
      continue;
    }

    if (inDepArray) {
      if (line === "]") { inDepArray = false; continue; }
      const quoted = line.match(/^["']([a-zA-Z0-9_][a-zA-Z0-9._-]*)/);
      if (quoted) {
        entries.push({ name: quoted[1].toLowerCase(), registry: "pypi", source: path });
      }
    }

    // Poetry table: `package-name = "^1.0"` or `package-name = {version = "..."}`
    if (inPoetryDepTable) {
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([a-zA-Z0-9_][a-zA-Z0-9._-]*)\s*=/);
      if (match) {
        const name = match[1].toLowerCase();
        if (name !== "python") {
          entries.push({ name, registry: "pypi", source: path });
        }
      }
    }
  }
  return entries;
}

function extractQuotedStrings(s: string): string[] {
  const matches = s.match(/["']([^"']+)["']/g);
  return matches ? matches.map((m) => m.slice(1, -1)) : [];
}

/**
 * Vendored / build-output paths whose contents are not the skill's own
 * declared dependencies — they're already-installed copies or generated.
 */
const VENDORED_PATH_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)vendor\//,
  /(^|\/)__pycache__\//,
  /(^|\/)\.venv\//,
  /(^|\/)venv\//,
  /(^|\/)target\//,
  /(^|\/)\.cargo\//,
];

function isVendoredPath(path: string): boolean {
  return VENDORED_PATH_PATTERNS.some((re) => re.test(path));
}

/**
 * Scan a skill version's files for recognized dependency files and extract
 * package names. Only checks files that can trigger automatic installation
 * (requirements.txt, package.json, Cargo.toml, etc.) — frontmatter
 * declarations in SKILL.md are informational and not scanned. Files inside
 * vendored / build-output directories are skipped because their contents
 * describe already-resolved copies, not the skill's own install-time deps.
 */
async function extractDependencies(
  ctx: ActionCtx,
  version: Doc<"skillVersions">,
): Promise<DepEntry[]> {
  const entries: DepEntry[] = [];

  for (const file of version.files) {
    if (isVendoredPath(file.path)) continue;
    const basename = file.path.split("/").pop()?.toLowerCase() ?? "";
    const parser = DEP_FILE_PARSERS[basename];
    if (!parser) continue;
    try {
      const blob = await ctx.storage.get(file.storageId as Id<"_storage">);
      if (!blob) continue;
      const content = await blob.text();
      entries.push(...parser(content, file.path));
    } catch {
      // Skip unreadable files
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// npm scope registration check
// ---------------------------------------------------------------------------

/**
 * Check whether an npm scope (e.g. "@acme") has any published packages.
 * Returns true if the scope appears to be claimed (>=1 package whose name
 * literally begins with `@scope/`), false if no such package exists,
 * null on network error.
 *
 * An unregistered scope is a strong dependency-confusion signal: an attacker
 * could register the scope and inject any package name under it.
 *
 * Implementation note: npm's v1 search API does not honor the `scope:`
 * qualifier, so we send the scope name as free-text and filter results
 * client-side by exact `@scope/` prefix match.
 */
async function checkNpmScopeRegistered(
  scope: string,
): Promise<{ registered: boolean } | { registered: null }> {
  // Normalize: ensure leading @
  const scopeWithAt = scope.startsWith("@") ? scope : `@${scope}`;
  const queryText = scopeWithAt; // free-text search; we filter results below
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(queryText)}&size=20`;
  const prefix = `${scopeWithAt}/`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.status === 200) {
        const body = (await response.json()) as {
          objects?: Array<{ package?: { name?: string } }>;
        };
        const hasMatch =
          (body.objects ?? []).some(
            (o) => typeof o.package?.name === "string" && o.package.name.startsWith(prefix),
          ) ?? false;
        return { registered: hasMatch };
      }

      if (response.status === 429 || response.status >= 500) {
        if (attempt < MAX_RETRIES) {
          const delay = 2 ** attempt * BACKOFF_BASE_MS + Math.random() * 1_000;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
      break;
    } catch {
      clearTimeout(timeout);
      if (attempt < MAX_RETRIES) {
        const delay = 2 ** attempt * BACKOFF_BASE_MS + Math.random() * 1_000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }
  }

  console.warn(`depRegistryScan: failed to check npm scope ${scope}`);
  return { registered: null };
}

// ---------------------------------------------------------------------------
// Registry HTTP check (with retry + backoff)
// ---------------------------------------------------------------------------

async function checkRegistryExists(
  registry: SupportedRegistry,
  packageName: string,
): Promise<{ exists: boolean; httpStatus: number } | { exists: null; httpStatus: null }> {
  // npm scoped packages (@scope/name) need the @ literal, only the rest encoded.
  const encodedName =
    registry === "npm" && packageName.startsWith("@")
      ? `@${encodeURIComponent(packageName.slice(1))}`
      : encodeURIComponent(packageName);
  const url = REGISTRY_ENDPOINTS[registry].replace("{name}", encodedName);
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  // crates.io requires a User-Agent header
  if (registry === "cargo") {
    headers["User-Agent"] = "ClawHub-DepRegistryScan/1.0 (https://openclaw.com)";
  }

  let lastStatus: number | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      lastStatus = response.status;

      if (response.status === 200) return { exists: true, httpStatus: 200 };
      if (response.status === 404) return { exists: false, httpStatus: 404 };

      // Retryable: 429 rate-limited or 5xx server error
      if (response.status === 429 || response.status >= 500) {
        if (attempt < MAX_RETRIES) {
          const delay = 2 ** attempt * BACKOFF_BASE_MS + Math.random() * 1_000;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }

      // Non-retryable unexpected status
      break;
    } catch {
      clearTimeout(timeout);
      if (attempt < MAX_RETRIES) {
        const delay = 2 ** attempt * BACKOFF_BASE_MS + Math.random() * 1_000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }
  }

  // All retries exhausted
  console.warn(
    `depRegistryScan: failed to check ${registry}/${packageName} after ${MAX_RETRIES + 1} attempts (last status: ${lastStatus})`,
  );
  return { exists: null, httpStatus: null };
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

export const lookupCacheInternal = internalQuery({
  args: {
    registry: v.union(v.literal("pypi"), v.literal("npm"), v.literal("cargo")),
    name: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<"depRegistryCache"> | null> => {
    return ctx.db
      .query("depRegistryCache")
      .withIndex("by_registry_name", (q) => q.eq("registry", args.registry).eq("name", args.name))
      .unique();
  },
});

export const upsertCacheInternal = internalMutation({
  args: {
    registry: v.union(v.literal("pypi"), v.literal("npm"), v.literal("cargo")),
    name: v.string(),
    exists: v.boolean(),
    httpStatus: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("depRegistryCache")
      .withIndex("by_registry_name", (q) => q.eq("registry", args.registry).eq("name", args.name))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        exists: args.exists,
        httpStatus: args.httpStatus,
        checkedAt: now,
      });
    } else {
      await ctx.db.insert("depRegistryCache", {
        registry: args.registry,
        name: args.name,
        exists: args.exists,
        httpStatus: args.httpStatus,
        checkedAt: now,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Main scanner action
// ---------------------------------------------------------------------------

export const checkDependencyRegistries = internalAction({
  args: { versionId: v.id("skillVersions") },
  handler: async (ctx, args) => {
    const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
      versionId: args.versionId,
    })) as Doc<"skillVersions"> | null;
    if (!version) return;

    // Already scanned and not in error state -> skip
    if (version.depRegistryAnalysis && version.depRegistryAnalysis.status !== "error") return;

    // Extract dependencies from both frontmatter and actual dependency files
    const allDeps = await extractDependencies(ctx, version);

    // Deduplicate by registry+name
    const seen = new Set<string>();
    const unique = allDeps.filter((d) => {
      if (!d.name) return false;
      const key = `${d.registry}:${d.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // No checkable dependencies -> clean
    if (unique.length === 0) {
      await ctx.runMutation(internal.skills.updateVersionDepRegistryAnalysisInternal, {
        versionId: args.versionId,
        depRegistryAnalysis: {
          status: "clean",
          results: [],
          notFoundPackages: [],
          summary: "No pip/npm/cargo dependencies to check.",
          checkedAt: Date.now(),
        },
      });
      return;
    }

    const results: Array<{
      registry: string;
      name: string;
      exists: boolean;
      httpStatus?: number;
    }> = [];
    let consecutiveFailures = 0;
    let abortedDueToErrors = false;

    for (const dep of unique) {
      // Check cache first
      const cached = (await ctx.runQuery(internal.depRegistryScan.lookupCacheInternal, {
        registry: dep.registry,
        name: dep.name,
      })) as Doc<"depRegistryCache"> | null;

      if (cached) {
        const ttl = cached.exists ? CACHE_TTL_EXISTS_MS : CACHE_TTL_NOT_EXISTS_MS;
        if (Date.now() - cached.checkedAt < ttl) {
          results.push({
            registry: dep.registry,
            name: dep.name,
            exists: cached.exists,
            httpStatus: cached.httpStatus,
          });
          consecutiveFailures = 0;
          continue;
        }
      }

      // Query the registry
      const check = await checkRegistryExists(dep.registry, dep.name);

      if (check.exists === null) {
        // Network error — count towards abort threshold. Do NOT add to results
        // (the package is neither confirmed-found nor confirmed-missing).
        consecutiveFailures++;
        if (consecutiveFailures >= CONSECUTIVE_FAILURE_ABORT) {
          console.warn(
            `depRegistryScan: aborting after ${CONSECUTIVE_FAILURE_ABORT} consecutive failures for version ${args.versionId}`,
          );
          abortedDueToErrors = true;
          break;
        }
      } else {
        consecutiveFailures = 0;
        results.push({
          registry: dep.registry,
          name: dep.name,
          exists: check.exists,
          httpStatus: check.httpStatus,
        });
        // Update cache
        await ctx.runMutation(internal.depRegistryScan.upsertCacheInternal, {
          registry: dep.registry,
          name: dep.name,
          exists: check.exists,
          httpStatus: check.httpStatus,
        });
      }

      // Inter-request delay to avoid rate limiting
      if (dep !== unique[unique.length - 1]) {
        await new Promise((r) => setTimeout(r, INTER_REQUEST_DELAY_MS));
      }
    }

    const notFoundPackages = results
      .filter((r) => !r.exists)
      .map((r) => `${r.name} (${r.registry})`);

    // For any not-found scoped npm packages, also check whether the scope
    // itself is registered on npm. An unregistered scope is a higher-risk
    // signal: an attacker could register the scope and inject any package
    // under it (full namespace takeover).
    const unregisteredScopes: string[] = [];
    if (!abortedDueToErrors) {
      const scopesToCheck = new Set<string>();
      for (const r of results) {
        if (!r.exists && r.registry === "npm" && r.name.startsWith("@")) {
          const scope = r.name.split("/")[0]; // "@scope"
          scopesToCheck.add(scope);
        }
      }
      for (const scope of scopesToCheck) {
        // Reuse depRegistryCache for scope lookups (key: registry=npm, name=@scope)
        const cached = (await ctx.runQuery(internal.depRegistryScan.lookupCacheInternal, {
          registry: "npm",
          name: scope,
        })) as Doc<"depRegistryCache"> | null;
        let registered: boolean | null = null;
        if (cached) {
          const ttl = cached.exists ? CACHE_TTL_EXISTS_MS : CACHE_TTL_NOT_EXISTS_MS;
          if (Date.now() - cached.checkedAt < ttl) {
            registered = cached.exists;
          }
        }
        if (registered === null) {
          const check = await checkNpmScopeRegistered(scope);
          if (check.registered !== null) {
            registered = check.registered;
            await ctx.runMutation(internal.depRegistryScan.upsertCacheInternal, {
              registry: "npm",
              name: scope,
              exists: registered,
              httpStatus: 200,
            });
          }
        }
        if (registered === false) unregisteredScopes.push(scope);
        await new Promise((r) => setTimeout(r, INTER_REQUEST_DELAY_MS));
      }
    }

    let status: "clean" | "suspicious" | "error";
    let summary: string;

    if (notFoundPackages.length > 0) {
      // Suspicious takes priority even if we also aborted — confirmed phantom
      // packages are a real signal regardless of incomplete scan.
      status = "suspicious";
      const pkgList = notFoundPackages.join(", ");
      const abortNote = abortedDueToErrors ? " (scan was partially completed due to network failures)" : "";
      const scopeNote =
        unregisteredScopes.length > 0
          ? ` HIGHER RISK: the following npm scope(s) are not yet registered and could be claimed by an attacker — ${unregisteredScopes.join(", ")}.`
          : "";
      summary = `${notFoundPackages.length} declared dependency package(s) not found on their public registry: ${pkgList}. This may indicate a typosquatting attempt, dependency confusion attack, or a reference to a non-existent package.${abortNote}${scopeNote}`;
    } else if (abortedDueToErrors) {
      status = "error";
      summary =
        "Dependency registry check aborted due to repeated network failures. Will be retried later.";
    } else {
      status = "clean";
      summary = `All ${results.length} declared dependency package(s) verified as present on their public registries.`;
    }

    await ctx.runMutation(internal.skills.updateVersionDepRegistryAnalysisInternal, {
      versionId: args.versionId,
      depRegistryAnalysis: {
        status,
        results,
        notFoundPackages,
        unregisteredScopes: unregisteredScopes.length > 0 ? unregisteredScopes : undefined,
        summary,
        checkedAt: Date.now(),
      },
    });
  },
});

// ---------------------------------------------------------------------------
// Rescan: retry versions with error status
// ---------------------------------------------------------------------------

export const getErrorDepRegistryVersionsInternal = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    // NOTE: JS-filtering on a nested field is acceptable here because this is
    // a low-frequency maintenance query (manual or cron), not a hot read path.
    // Adding a denormalized index field would require a Trigger + schema change
    // for negligible benefit.
    const versions = await ctx.db.query("skillVersions").order("desc").take(500);
    return versions
      .filter((ver) => ver.depRegistryAnalysis?.status === "error")
      .slice(0, limit)
      .map((ver) => ver._id);
  },
});

export const rescanErrorDepRegistryVersions = internalAction({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 25;
    const versionIds = (await ctx.runQuery(
      internal.depRegistryScan.getErrorDepRegistryVersionsInternal,
      { limit: batchSize },
    )) as Id<"skillVersions">[];

    let scheduled = 0;
    for (const versionId of versionIds) {
      await ctx.scheduler.runAfter(
        scheduled * 2_000, // stagger by 2s to avoid burst
        internal.depRegistryScan.checkDependencyRegistries,
        { versionId },
      );
      scheduled++;
    }

    console.log(`depRegistryScan: scheduled ${scheduled} error-state rescans`);
    return { scheduled };
  },
});
