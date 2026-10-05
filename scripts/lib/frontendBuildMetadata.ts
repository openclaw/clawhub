import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DEPLOYMENT_METADATA_PATH = "/.well-known/clawhub-deployment.json";

// Vite applies this supported override to both direct and dynamic env reads.
// Retired process/.env values must not keep changing the shared client env chunk.
export const analyticsReleaseDefine = {
  "import.meta.env.VITE_GA4_RELEASE": "undefined",
};

type RuntimeAsset = { path: string; sha256: string };
const runtimeAssetPath = /^\/assets\/runtimeEnv-[\w-]{8}\.js$/;

function deploymentMetadata(commit: string | undefined, runtimeAsset: RuntimeAsset) {
  const sha = commit?.trim().toLowerCase();
  return {
    schema_version: 1,
    git_commit_sha: sha && /^[a-f0-9]{40}$/.test(sha) ? sha : null,
    runtime_asset: runtimeAsset,
  };
}

export function parseDeploymentMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const asset = record.runtime_asset as Partial<RuntimeAsset> | null;
  if (
    Object.keys(record).sort().join(",") !== "git_commit_sha,runtime_asset,schema_version" ||
    record.schema_version !== 1 ||
    (record.git_commit_sha !== null &&
      (typeof record.git_commit_sha !== "string" ||
        !/^[a-f0-9]{40}$/.test(record.git_commit_sha))) ||
    !asset ||
    typeof asset !== "object" ||
    Array.isArray(asset) ||
    Object.keys(asset).sort().join(",") !== "path,sha256" ||
    typeof asset.path !== "string" ||
    !runtimeAssetPath.test(asset.path) ||
    typeof asset.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(asset.sha256)
  )
    return null;
  return {
    schema_version: 1,
    git_commit_sha: record.git_commit_sha as string | null,
    runtime_asset: { path: asset.path, sha256: asset.sha256 },
  };
}

export function writeDeploymentMetadata(
  commit: string | undefined,
  outputRoots = [".output/public", ".vercel/output/static"],
) {
  const roots = outputRoots.filter((root) => existsSync(root));
  if (!roots.length) throw new Error("Frontend static output directory is missing");
  // Bind the deployment identity to the bytes emitted by this completed build.
  // Multiple candidates indicate stale/ambiguous output; never guess which shipped.
  const assets = roots.map((root) => {
    const paths = readdirSync(path.join(root, "assets"))
      .map((name) => `/assets/${name}`)
      .filter((name) => runtimeAssetPath.test(name));
    if (paths.length !== 1) throw new Error("Expected exactly one built runtime asset");
    return {
      path: paths[0],
      sha256: createHash("sha256")
        .update(readFileSync(path.join(root, paths[0].slice(1))))
        .digest("hex"),
    };
  });
  if (assets.some((asset) => JSON.stringify(asset) !== JSON.stringify(assets[0])))
    throw new Error("Frontend output runtime assets disagree");
  const metadata = deploymentMetadata(commit, assets[0]);
  for (const root of roots) {
    const target = path.join(root, DEPLOYMENT_METADATA_PATH.slice(1));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(metadata)}\n`);
  }
  return metadata;
}
