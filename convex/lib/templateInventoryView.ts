import {
  templateBundledMetadataPaths,
  validateTemplatePackageContents,
  TEMPLATE_BOOTSTRAP_FILE_NAMES,
} from "clawhub-schema/templatePackage";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { parseClawPack } from "./clawpack";
import { json, text } from "./httpHeaders";
import { toPackageMetadataResponse } from "./packageReadProjection";
import { toPackageReleaseSecurityResponse } from "./packageReleaseSecurityResponse";

// This display read has a smaller byte budget than publication. Larger archives
// stay available through the normal exact-version verified archive path.
const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
type Artifact = { kind: "npm-pack"; sha256: string; npmIntegrity: string; npmShasum?: string };
async function verifiedInventory(
  bytes: Uint8Array,
  packageName: string,
  version: string,
  artifact: Artifact,
) {
  const pack = await parseClawPack(bytes, { maxTarBytes: 8 * 1024 * 1024 });
  if (
    pack.artifactSha256 !== artifact.sha256 ||
    pack.npmIntegrity !== artifact.npmIntegrity ||
    (artifact.npmShasum !== undefined && pack.npmShasum !== artifact.npmShasum) ||
    pack.packageName !== packageName ||
    pack.packageVersion !== version
  )
    throw Error("Invalid artifact");
  const openclaw = pack.packageJson.openclaw;
  if (
    !openclaw ||
    typeof openclaw !== "object" ||
    !("template" in openclaw) ||
    typeof openclaw.template !== "string"
  )
    throw Error("Invalid envelope");
  const manifestPath = openclaw.template;
  const manifestEntry = pack.entries.find((e) => e.path === manifestPath);
  if (!manifestEntry || manifestEntry.bytes.length > 1024 * 1024) throw Error("Invalid manifest");
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  const manifestText = utf8.decode(manifestEntry.bytes);
  const markers = new Set([
    "BOOTSTRAP.md",
    ...templateBundledMetadataPaths(
      manifestText,
      manifestPath,
      pack.entries.map((e) => e.path),
    ),
  ]);
  const checked = validateTemplatePackageContents({
    packageName,
    version,
    packageJson: pack.packageJson,
    files: pack.entries.map(({ path, bytes: entry }) => ({
      path,
      size: entry.length,
      ...(path === manifestPath
        ? { text: manifestText }
        : markers.has(path)
          ? { text: utf8.decode(entry) }
          : {}),
    })),
  });
  if (!checked.ok) throw Error("Invalid Template");
  const {
    manifest,
    summary: templateManifestSummary,
    inventory,
    hasTemplateMarkdownBody,
  } = checked.value;
  const instructions = [
    ...TEMPLATE_BOOTSTRAP_FILE_NAMES.flatMap((name) => {
      const file = manifest.workspace?.bootstrapFiles?.[name];
      return file ? [{ name, source: file.source }] : [];
    }),
    ...(manifest.workspace?.files ?? []).map((file) => ({ name: file.path, source: file.source })),
  ];
  if (pack.entries.some((e) => e.path === "BOOTSTRAP.md"))
    instructions.push({ name: "BOOTSTRAP.md", source: "BOOTSTRAP.md" });
  if (hasTemplateMarkdownBody) instructions.push({ name: "SOUL.md", source: "CLAW.md#body" });
  const dependencyRow = (d: (typeof inventory)[number]) =>
    d.source === "bundled"
      ? {
          name:
            checked.value.bundledSources.find((s) => s.kind === d.kind && s.path === d.path)
              ?.name ?? d.path,
          source: d.source,
          path: d.path,
        }
      : { name: d.ref, source: d.source, ref: d.ref, version: d.version };
  const contents = {
    instructions,
    skills: inventory.filter((d) => d.kind === "skill").map(dependencyRow),
    integrations: [
      ...inventory
        .filter((d) => d.kind === "plugin")
        .map((d) => ({ ...dependencyRow(d), kind: "plugin" as const })),
      ...Object.keys(manifest.mcpServers ?? {}).map((name) => ({
        name,
        kind: "mcpServer" as const,
      })),
    ],
    automations: (manifest.automations ?? []).map((job) => ({
      name: job.name || job.id,
      enabled: job.enabled ?? true,
      schedule: job.schedule.cron,
      timezone: job.schedule.timezone,
    })),
  };
  const data = { manifestPath, templateManifestSummary, contents };
  if (new TextEncoder().encode(JSON.stringify(data)).length > MAX_OUTPUT_BYTES)
    throw Error("Inventory too large");
  return data;
}

export async function templateInventoryViewResponse(
  ctx: ActionCtx,
  request: Request,
  name: string,
  headers: HeadersInit,
) {
  const params = new URL(request.url).searchParams;
  const versions = params.getAll("version");
  if (
    versions.length > 1 ||
    (versions[0] !== undefined && (!versions[0] || versions[0].length > 256))
  )
    return text("Invalid version", 400, headers);
  const selected = await ctx.runQuery(internal.packages.getPublicTemplateInventoryInternal, {
    name,
    ...(versions[0] === undefined ? {} : { version: versions[0] }),
  });
  if (!selected) return text("Template not found", 404, headers);
  if (selected.blocked) return text("Release unavailable", 403, headers);
  const { release, package: pkg, owner, tags } = selected;
  const { version, clawpackStorageId, clawpackSha256, clawpackSize, npmIntegrity, npmShasum } =
    release;
  if (
    release.artifactKind !== "npm-pack" ||
    !clawpackStorageId ||
    !clawpackSha256 ||
    !npmIntegrity ||
    !clawpackSize
  )
    return text("Template inventory unavailable", 422, headers);
  const artifact: Artifact = {
    kind: "npm-pack",
    sha256: clawpackSha256,
    npmIntegrity,
    ...(npmShasum === undefined ? {} : { npmShasum }),
  };
  const metadata = toPackageMetadataResponse(pkg, owner, tags);
  if (clawpackSize > MAX_ARCHIVE_BYTES) return text("Template inventory too large", 413, headers);
  const blob = await ctx.storage.get(clawpackStorageId);
  if (!blob || blob.size !== clawpackSize)
    return text("Template inventory integrity mismatch", 422, headers);
  try {
    const data = await verifiedInventory(
      new Uint8Array(await blob.arrayBuffer()),
      pkg.name,
      version,
      artifact,
    );
    const security = toPackageReleaseSecurityResponse({
      request,
      pkg,
      release,
      ownerHandle: owner?.handle,
    });
    const payload = {
      ...metadata,
      templateInventory: {
        schemaVersion: 1,
        packageName: pkg.name,
        version,
        artifact,
        icon: release.icon ?? null,
        ...data,
        security,
      },
    };
    if (new TextEncoder().encode(JSON.stringify(payload)).length > 512 * 1024)
      return text("Template inventory too large", 413, headers);
    return json(payload, 200, headers);
  } catch {
    // Parser diagnostics can quote publisher file contents: never return them here.
    return text("Template inventory could not be verified", 422, headers);
  }
}
