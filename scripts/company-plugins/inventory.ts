import { createHash } from "node:crypto";
import { buildGitHubFolderContentHash } from "../../packages/clawhub/src/skills";
import { resolvePluginCategories } from "../../packages/schema/src/catalogMetadata";
import { inspectCapabilities } from "./capabilities";
import {
  curatedManifestSchema,
  sourceKey,
  type CuratedManifest,
  type CuratedSource,
  type Registry,
  type Snapshot,
} from "./contract";
import { inspectLicense } from "./license";
export type InventoryInput = {
  manifest: CuratedManifest;
  snapshots: Snapshot[];
  catalog: { name: string; publisher?: string }[];
};
type Format = "cursor" | "claude" | "codex" | "agent" | "openclaw";
type Discovery = {
  name: string;
  repo: string;
  path: string;
  registry?: Registry;
  registryCommit?: string;
  description?: string;
  category?: string;
  upstream?: unknown;
  discoveryError?: string;
};
type Candidate = Discovery & {
  commit?: string;
  sourceUrl?: string;
  integration?: string;
  job?: string;
  publisher?: string;
  authorship?: string;
  format?: Format;
  declaredAuthor?: unknown;
  declaredLicense?: unknown;
  upstreamVersion?: string;
  icon?: string;
  categories: string[];
  capabilities: { runnable: string[]; omitted: string[] };
  license?: ReturnType<typeof inspectLicense>;
  contentHash?: string;
  status:
    | "uncurated"
    | "blocked"
    | "selected"
    | "superseded"
    | "existing-openclaw"
    | "needs-decision";
  reasons: string[];
  canonical?: string;
  ownershipEvidence?: string;
};
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function json(text: string | undefined) {
  if (!text) return {};
  return record(JSON.parse(text));
}
const markers = [
  { format: "openclaw", path: "openclaw.plugin.json" },
  { format: "codex", path: ".codex-plugin/plugin.json" },
  { format: "claude", path: ".claude-plugin/plugin.json" },
  { format: "cursor", path: ".cursor-plugin/plugin.json" },
  { format: "agent", path: "plugin.json" },
] as const;
const mappedCategories: Record<string, string[]> = {
  productivity: ["tools"],
  integrations: ["tools"],
  "developer tools": ["runtime"],
  development: ["runtime"],
  security: ["security"],
  design: ["media"],
  monitoring: ["gateway"],
  utilities: ["tools"],
};
function describe(
  discovered: Discovery,
  snapshot: Snapshot | undefined,
  source: CuratedSource | undefined,
): Candidate {
  const result: Candidate = {
    ...discovered,
    categories: [],
    capabilities: { runnable: [], omitted: [] },
    status: source ? "blocked" : "uncurated",
    reasons: [],
  };
  if (source)
    Object.assign(result, {
      integration: source.integration,
      job: source.job,
      publisher: source.publisher,
      authorship: source.authorship,
      ownershipEvidence: source.ownershipEvidence,
    });
  if (!snapshot) {
    result.reasons.push(
      "External source snapshot required; registry metadata is not source evidence",
    );
    return result;
  }
  result.commit = snapshot.commit;
  result.sourceUrl = `https://github.com/${snapshot.repo}/tree/${snapshot.commit}${discovered.path ? `/${discovered.path.split("/").map(encodeURIComponent).join("/")}` : ""}`;
  const prefix = discovered.path ? `${discovered.path}/` : "";
  const files = Object.fromEntries(
    Object.entries(snapshot.files)
      .filter(([p]) => p.startsWith(prefix))
      .map(([p, v]) => [p.slice(prefix.length), v]),
  );
  const marker = markers.find((m) => files[m.path] && (!source || m.format === source.format));
  if (!marker) {
    result.reasons.push("Supported plugin manifest not found");
    return result;
  }
  const manifest = json(files[marker.path]);
  const native = json(files["openclaw.plugin.json"]);
  const identifier = marker.format === "openclaw" ? manifest.id : manifest.name;
  if (typeof identifier !== "string" || !identifier.trim())
    throw new Error(`Invalid ${marker.format} manifest: plugin identity is required`);
  if (
    marker.format === "agent" &&
    manifest.$schema !== "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
  )
    throw new Error("Unsupported Agent Plugins manifest schema");
  result.format = marker.format;
  result.declaredAuthor = manifest.author;
  result.declaredLicense = manifest.license;
  result.description =
    typeof manifest.description === "string" ? manifest.description : discovered.description;
  result.upstreamVersion = typeof manifest.version === "string" ? manifest.version : undefined;
  const ui = record(manifest.interface);
  result.icon =
    typeof manifest.logo === "string"
      ? manifest.logo
      : typeof ui.logo === "string"
        ? ui.logo
        : undefined;
  const capabilities = inspectCapabilities(files, manifest, marker.format);
  result.capabilities = { runnable: capabilities.runnable, omitted: capabilities.omitted };
  result.reasons.push(...capabilities.errors);
  result.license = inspectLicense(snapshot.files, discovered.path);
  const category = String(
    manifest.category ?? ui.category ?? discovered.category ?? "",
  ).toLowerCase();
  result.categories = resolvePluginCategories({
    declared: Array.isArray(native.categories) ? (native.categories as string[]) : undefined,
    inferred: source?.categories.length ? source.categories : mappedCategories[category],
  });
  const closurePaths = new Set([
    ...Object.keys(files).map((p) => prefix + p),
    ...result.license.files.map((file) => file.path),
    ...result.license.notices,
  ]);
  result.contentHash = buildGitHubFolderContentHash(
    [...closurePaths].map((path) => ({
      path,
      size: snapshot.fileSizes?.[path] ?? Buffer.byteLength(snapshot.files[path]),
      sha256:
        snapshot.fileHashes?.[path] ??
        createHash("sha256").update(snapshot.files[path]).digest("hex"),
    })),
  );
  if (source) {
    if (snapshot.repositoryId !== source.repositoryId || snapshot.ownerId !== source.ownerId)
      result.reasons.push("Verified repository/owner identity changed");
    if (!/^[a-f0-9]{40}$/.test(snapshot.commit)) result.reasons.push("Exact commit is required");
    if (manifest.license && manifest.license !== "MIT")
      result.reasons.push("Manifest license contradicts MIT-only policy");
    result.reasons.push(...result.license.reasons);
    if (!result.capabilities.runnable.length)
      result.reasons.push("No runnable OpenClaw capability");
    if (!result.reasons.length) result.status = "selected";
  } else result.reasons.push("Not in the curated source manifest");
  return result;
}
function discover(snapshot: Snapshot, registry: Registry): Discovery[] {
  const marketplace =
    registry === "cursor"
      ? ".cursor-plugin/marketplace.json"
      : registry === "claude"
        ? ".claude-plugin/marketplace.json"
        : ".agents/plugins/marketplace.json";
  const plugins = json(snapshot.files[marketplace]).plugins;
  if (!Array.isArray(plugins))
    throw new Error(`Missing marketplace: ${snapshot.repo}/${marketplace}`);
  return plugins.map((raw) => {
    const p = record(raw);
    const s = record(p.source);
    let repo = snapshot.repo;
    let path = typeof p.source === "string" ? p.source : typeof s.path === "string" ? s.path : "";
    if (typeof s.url === "string" || typeof s.repo === "string") {
      const url = String(s.url ?? `https://github.com/${s.repo}`);
      const match = /^https:\/\/github.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url);
      repo = match?.[1]?.toLowerCase() ?? url;
    }
    path = path.replace(/^\.\//, "").replace(/\/$/, "");
    const unsafePath =
      path.startsWith("/") ||
      /[\\\0]/.test(path) ||
      Boolean(path && path.split("/").some((part) => !part || part === ".." || part === "."));
    return {
      name: String(p.name ?? ""),
      repo,
      path,
      registry,
      registryCommit: snapshot.commit,
      description: typeof p.description === "string" ? p.description : undefined,
      category: typeof p.category === "string" ? p.category : undefined,
      upstream: p.source,
      ...(unsafePath ? { discoveryError: "Unsafe registry source path" } : {}),
    };
  });
}
export async function inventoryPlugins(input: InventoryInput) {
  const manifest = curatedManifestSchema.parse(input.manifest);
  const byRepo = new Map(input.snapshots.map((s) => [s.repo.toLowerCase(), s]));
  const sources = new Map<string, CuratedSource>();
  for (const s of manifest.sources) {
    const key = sourceKey(s.repo, s.path);
    if (sources.has(key)) throw new Error(`Duplicate curated source: ${key}`);
    sources.set(key, s);
  }
  const openclawIdentities = new Set<string>();
  for (const entry of manifest.openclaw) {
    const key = `${entry.integration}/${entry.job}`;
    if (openclawIdentities.has(key)) throw new Error(`Duplicate OpenClaw identity: ${key}`);
    openclawIdentities.add(key);
  }
  const discoveries: Discovery[] = [];
  for (const reg of manifest.registries) {
    const snapshot = byRepo.get(reg.repo);
    if (!snapshot) throw new Error(`Missing registry snapshot: ${reg.repo}`);
    discoveries.push(...discover(snapshot, reg.registry));
  }
  for (const source of manifest.sources)
    if (!discoveries.some((d) => sourceKey(d.repo, d.path) === sourceKey(source.repo, source.path)))
      discoveries.push({
        name: source.integration,
        repo: source.repo,
        path: source.path,
        registry: source.registry,
      });
  const candidates = discoveries.map((d): Candidate => {
    const source = sources.get(sourceKey(d.repo, d.path));
    try {
      if (d.discoveryError) throw new Error(d.discoveryError);
      return describe(d, byRepo.get(d.repo), source);
    } catch (error) {
      return {
        ...d,
        integration: source?.integration,
        job: source?.job,
        publisher: source?.publisher,
        status: "blocked",
        categories: [],
        capabilities: { runnable: [], omitted: [] },
        reasons: [error instanceof Error ? error.message : "Invalid source metadata"],
      };
    }
  });
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (!c.integration || !c.job) continue;
    const identity = `${c.integration}/${c.job}`;
    groups.set(identity, [...(groups.get(identity) ?? []), c]);
  }
  const parityGaps: CuratedManifest["openclaw"] = [];
  for (const [identity, group] of groups) {
    const existing = manifest.openclaw.find(
      (o) =>
        `${o.integration}/${o.job}` === identity &&
        (o.bundledId || input.catalog.some((p) => p.name === o.package)),
    );
    if (existing) {
      if (existing.bundledId && !input.catalog.some((p) => p.name === existing.package))
        parityGaps.push(existing);
      for (const c of group) {
        c.status = "existing-openclaw";
        c.canonical = input.catalog.some((p) => p.name === existing.package)
          ? existing.package
          : existing.bundledId;
        c.reasons.push("Equivalent OpenClaw integration has precedence");
      }
      continue;
    }
    const eligible = group.filter((c) => c.status === "selected");
    const unique = [...new Map(eligible.map((c) => [sourceKey(c.repo, c.path), c])).values()];
    unique.sort((a, b) => {
      const tier = (c: Candidate) => (c.authorship === "company" ? 0 : 1);
      return (
        tier(a) - tier(b) ||
        b.capabilities.runnable.length - a.capabilities.runnable.length ||
        Date.parse(byRepo.get(b.repo)!.updatedAt) - Date.parse(byRepo.get(a.repo)!.updatedAt)
      );
    });
    let winner = unique[0];
    if (!winner) continue;
    const tied = unique.filter(
      (c) =>
        c.authorship === winner.authorship &&
        c.capabilities.runnable.length === winner.capabilities.runnable.length &&
        byRepo.get(c.repo)!.updatedAt === byRepo.get(winner.repo)!.updatedAt,
    );
    if (tied.length > 1) {
      const preferred = tied.filter((c) => sources.get(sourceKey(c.repo, c.path))?.preferred);
      if (preferred.length !== 1) {
        for (const c of eligible) {
          const inTie = tied.some(
            (option) => sourceKey(option.repo, option.path) === sourceKey(c.repo, c.path),
          );
          c.status = inTie ? "needs-decision" : "superseded";
          c.reasons.push(
            inTie
              ? "Equivalent candidates require an explicit curator decision"
              : "Lower-ranked than the unresolved canonical candidates",
          );
        }
        continue;
      }
      winner = preferred[0];
    }
    for (const c of eligible) {
      if (c === winner) {
        c.reasons.push(
          "Canonical source selected by provenance, runnable coverage and maintenance",
        );
        continue;
      }
      c.status = "superseded";
      c.canonical = sourceKey(winner.repo, winner.path);
      c.reasons.push(
        sourceKey(c.repo, c.path) === sourceKey(winner.repo, winner.path)
          ? "Exact source duplicate"
          : "Same integration and primary job",
      );
    }
  }
  candidates.sort(
    (a, b) =>
      sourceKey(a.repo, a.path).localeCompare(sourceKey(b.repo, b.path)) ||
      String(a.registry).localeCompare(String(b.registry)),
  );
  return {
    version: 1,
    snapshots: input.snapshots.map(
      ({ files: _, fileBytes: _bytes, fileHashes: __, fileSizes: ___, ...s }) => s,
    ),
    candidates,
    parityGaps,
    permissionNeeded: candidates
      .filter((c) => c.license?.status === "blocked" && ["uncurated", "blocked"].includes(c.status))
      .map((c) => ({ repo: c.repo, path: c.path, reasons: c.license!.reasons })),
  };
}
