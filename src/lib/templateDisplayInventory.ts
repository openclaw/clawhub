import { type } from "arktype";
import { TemplateManifestSummarySchema } from "clawhub-schema";
import { isSafeTemplatePackagePath } from "clawhub-schema/templatePaths";
import type { PackageDetailResponse } from "./packageApi";
import { normalizePublisherHandle } from "./templateRoutes";

const namedPath = type({ name: "string > 0", source: "'bundled'", path: "string > 0" });
const namedRef = type({
  name: "string > 0",
  source: "'clawhub'",
  ref: "string > 0",
  version: "string > 0",
});
const plugin = type({ kind: "'plugin'" });
const sha256 = /^[a-f0-9]{64}$/;
const integrity = /^sha512-[A-Za-z0-9+/]{86}==$/;
const sha1 = /^[a-f0-9]{40}$/;
const scanStatus = "'clean' | 'suspicious' | 'malicious' | 'pending' | 'not-run'";

// Only whitelisted display values are serialized into route data. An inventory is
// never install input, proof of Add eligibility, or a substitute for an authorized file read.
const inventorySchema = type({
  schemaVersion: "1",
  packageName: "string > 0",
  version: "string > 0",
  manifestPath: "string > 0",
  templateManifestSummary: TemplateManifestSummarySchema,
  artifact: { kind: "'npm-pack'", sha256, npmIntegrity: integrity, "npmShasum?": sha1 },
  contents: {
    instructions: type({ name: "string > 0", source: "string > 0" }).array(),
    skills: namedPath.or(namedRef).array(),
    integrations: namedPath
      .and(plugin)
      .or(namedRef.and(plugin))
      .or(type({ name: "string > 0", kind: "'mcpServer'" }))
      .array(),
    automations: type({
      name: "string > 0",
      enabled: "boolean",
      schedule: "string > 0",
      timezone: "string > 0",
    }).array(),
  },
  security: {
    package: { name: "string > 0", family: "'template'" },
    release: {
      version: "string > 0",
      artifactKind: "'npm-pack'",
      artifactSha256: sha256,
      npmIntegrity: integrity,
      "npmShasum?": sha1,
    },
    overview: "string",
    "verdict?": "string",
    securityAuditUrl: "string",
    trust: {
      blockedFromDownload: "boolean",
      scanStatus,
      pending: "boolean",
      stale: "boolean",
      reasons: "string[]",
    },
  },
}).onDeepUndeclaredKey("delete");

export type TemplateDisplayInventory = typeof inventorySchema.infer;

export function requireCurrentTemplateInventory(
  raw: unknown,
  detail: PackageDetailResponse,
  params: { owner: string; slug: string },
): TemplateDisplayInventory {
  const inv = inventorySchema(raw),
    pkg = detail.package;
  if (
    inv instanceof type.errors ||
    !pkg ||
    !pkg.latestVersion ||
    pkg.family !== "template" ||
    (pkg.channel !== "community" && pkg.channel !== "official") ||
    pkg.scanStatus === "malicious" ||
    !detail.owner?.handle ||
    normalizePublisherHandle(detail.owner.handle) !== normalizePublisherHandle(params.owner) ||
    (pkg.ownerHandle &&
      normalizePublisherHandle(pkg.ownerHandle) !== normalizePublisherHandle(params.owner)) ||
    (pkg.name.toLowerCase() !== params.slug.toLowerCase() &&
      pkg.name.toLowerCase() !==
        "@" + normalizePublisherHandle(params.owner) + "/" + params.slug.toLowerCase()) ||
    inv.packageName !== pkg.name ||
    inv.security.package.name !== pkg.name ||
    inv.version !== pkg.latestVersion ||
    inv.security.release.version !== inv.version ||
    inv.security.release.artifactSha256 !== inv.artifact.sha256 ||
    inv.security.release.npmIntegrity !== inv.artifact.npmIntegrity ||
    inv.security.release.npmShasum !== inv.artifact.npmShasum ||
    (pkg.artifact &&
      (pkg.artifact.kind !== inv.artifact.kind || pkg.artifact.sha256 !== inv.artifact.sha256)) ||
    inv.security.trust.blockedFromDownload ||
    inv.security.trust.scanStatus === "malicious" ||
    !isSafeTemplatePackagePath(inv.manifestPath) ||
    inv.manifestPath.split("/").at(-1) !== "CLAW.md" ||
    inv.contents.instructions.some(
      (row) =>
        !isSafeTemplatePackagePath(row.name) ||
        (row.source === "CLAW.md#body"
          ? row.name !== "SOUL.md"
          : !isSafeTemplatePackagePath(row.source)),
    ) ||
    inv.contents.skills.some(
      (row) => row.source === "bundled" && !isSafeTemplatePackagePath(row.path),
    ) ||
    inv.contents.integrations.some(
      (row) =>
        row.kind === "plugin" && row.source === "bundled" && !isSafeTemplatePackagePath(row.path),
    )
  ) {
    throw new Error("Invalid Template inventory from the registry");
  }
  return inv;
}
