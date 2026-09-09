import { posix } from "node:path";
import semver from "semver";
import { buildGitHubFolderContentHash, hashSkillFiles } from "../../packages/clawhub/src/skills";
import type { CuratedSource, Snapshot } from "./contract";
import { inventoryPlugins } from "./inventory";

const manifests: Record<CuratedSource["format"], string> = {
  cursor: ".cursor-plugin/plugin.json",
  claude: ".claude-plugin/plugin.json",
  codex: ".codex-plugin/plugin.json",
  agent: "plugin.json",
};
const omittedRoots: Record<string, string[]> = {
  rules: ["rules", ".cursor/rules"],
  agents: ["agents", ".cursor/agents"],
  hooks: ["hooks"],
  commands: ["commands"],
  outputStyles: ["output-styles"],
  apps: [".app.json"],
};
export async function preparePlugin({
  source,
  snapshot,
}: {
  source: CuratedSource;
  snapshot: Snapshot;
}) {
  const report = await inventoryPlugins({
    manifest: { version: 1, registries: [], sources: [source], openclaw: [] },
    snapshots: [snapshot],
    catalog: [],
  });
  const candidate = report.candidates[0];
  if (candidate.status !== "selected" || !candidate.contentHash || !candidate.license)
    throw new Error(`Source cannot be imported: ${candidate.reasons.join("; ")}`);
  const prefix = source.path ? `${source.path}/` : "";
  const files: Record<string, Uint8Array> = Object.fromEntries(
    Object.entries(snapshot.files)
      .filter(([p]) => p.startsWith(prefix))
      .map(([p, text]) => [p.slice(prefix.length), snapshot.fileBytes?.[p] ?? Buffer.from(text)]),
  );
  if (Object.hasOwn(files, "CLAWHUB_SOURCE.json"))
    throw new Error("Upstream uses reserved CLAWHUB_SOURCE.json path");
  const manifest = JSON.parse(Buffer.from(files[manifests[source.format]]).toString()) as Record<
    string,
    unknown
  >;
  const removed = new Set<string>();
  for (const capability of candidate.capabilities.omitted) {
    const value = manifest[capability];
    const paths =
      typeof value === "string"
        ? [value]
        : Array.isArray(value)
          ? value.filter((v): v is string => typeof v === "string")
          : [];
    for (const path of [...paths, ...(omittedRoots[capability] ?? [])])
      removed.add(path.replace(/^\.\//, "").replace(/\/$/, ""));
    delete manifest[capability];
  }
  for (const path of Object.keys(files))
    if ([...removed].some((root) => path === root || path.startsWith(`${root}/`)))
      delete files[path];
  const preserve = (path: string) => {
    const target = path.startsWith(prefix) ? path.slice(prefix.length) : posix.basename(path);
    const bytes = snapshot.fileBytes?.[path] ?? Buffer.from(snapshot.files[path]);
    if (files[target] && !Buffer.from(files[target]).equals(Buffer.from(bytes)))
      throw new Error(`Conflicting required notice at ${target}`);
    files[target] = bytes;
  };
  for (const file of candidate.license.files) preserve(file.path);
  for (const path of candidate.license.notices) preserve(path);
  // OpenClaw detects format from marker files. Keep only the selected marker
  // so a sibling Codex or Cursor manifest cannot silently change runtime behavior.
  for (const [format, path] of Object.entries(manifests)) {
    if (format !== source.format && format !== "openclaw" && format !== "agent") delete files[path];
    if (format === "agent" && format !== source.format && files[path]) {
      const data = JSON.parse(Buffer.from(files[path]).toString());
      if (data.$schema === "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json")
        delete files[path];
    }
  }
  const declaredIcon = candidate.icon?.replace(/^\.\//, "");
  const iconPath =
    declaredIcon &&
    !declaredIcon.startsWith("/") &&
    !declaredIcon.includes("\\") &&
    !declaredIcon.split("/").includes("..") &&
    files[declaredIcon]
      ? declaredIcon
      : undefined;
  const icon = iconPath
    ? `https://raw.githubusercontent.com/${source.repo}/${snapshot.commit}/${[source.path, iconPath].filter(Boolean).join("/").split("/").map(encodeURIComponent).join("/")}`
    : undefined;
  const runtimeId = `${source.integration}-${source.job}`;
  const native = files["openclaw.plugin.json"]
    ? JSON.parse(Buffer.from(files["openclaw.plugin.json"]).toString())
    : {};
  const displayName = String(manifest.displayName ?? manifest.name ?? source.integration);
  manifest.name = runtimeId;
  files[manifests[source.format]] = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  files["openclaw.plugin.json"] = Buffer.from(
    JSON.stringify(
      {
        ...native,
        id: runtimeId,
        name: displayName,
        description: candidate.description,
        icon,
        categories: candidate.categories,
        configSchema: native.configSchema ?? {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
      null,
      2,
    ) + "\n",
  );
  const provenance = {
    repo: source.repo,
    path: source.path,
    commit: snapshot.commit,
    ref: source.ref,
    sourceContentHash: candidate.contentHash,
    integration: source.integration,
    job: source.job,
    authorship: source.authorship,
    supersedes: source.supersedes,
    publisher: source.publisher,
    author: candidate.declaredAuthor,
    ownershipEvidence: source.ownershipEvidence,
    upstreamVersion: candidate.upstreamVersion,
    omittedCapabilities: candidate.capabilities.omitted,
    licenses: candidate.license.files.map(({ text: _, ...file }) => file),
    notices: candidate.license.notices,
    ...(candidate.icon && !icon ? { omittedIcon: candidate.icon } : {}),
  };
  files["CLAWHUB_SOURCE.json"] = Buffer.from(JSON.stringify(provenance, null, 2) + "\n");
  const hashes = hashSkillFiles(
    Object.entries(files).map(([relPath, bytes]) => ({ relPath, bytes })),
  ).files;
  const artifactHash = buildGitHubFolderContentHash(hashes);
  return {
    name: `@${source.publisher}/${runtimeId}`,
    displayName,
    // Initial imports preserve upstream versions. Existing-release reconciliation
    // belongs to the separately reviewed immutable synchronization layer.
    version:
      semver.valid(candidate.upstreamVersion ?? "") ?? `0.0.0+clawhub.${artifactHash.slice(0, 12)}`,
    categories: candidate.categories,
    files,
    artifactHash,
    sourceContentHash: candidate.contentHash,
    provenance,
  };
}
