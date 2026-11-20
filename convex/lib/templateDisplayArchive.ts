import {
  templateBundledMetadataPaths,
  validateTemplatePackageContents,
  TEMPLATE_BOOTSTRAP_FILE_NAMES,
} from "clawhub-schema/templatePackage";
import type { ActionCtx } from "../_generated/server";
import { parseClawPack } from "./clawpack";
import {
  MAX_TEMPLATE_DISPLAY_ARCHIVE_BYTES,
  MAX_TEMPLATE_DISPLAY_DATA_BYTES,
  type TemplateDisplayBinding,
  type TemplateDisplayData,
} from "./templateDisplayData";
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
  if (new TextEncoder().encode(JSON.stringify(data)).length > MAX_TEMPLATE_DISPLAY_DATA_BYTES)
    throw Error("Inventory too large");
  return data;
}

/** Only for trusted ingestion, bounded operator backfill, or the unprojected compatibility path. */
export async function readVerifiedTemplateDisplayArchive(
  storage: Pick<ActionCtx["storage"], "get">,
  binding: TemplateDisplayBinding,
): Promise<
  { ok: true; data: TemplateDisplayData } | { ok: false; status: 413 | 422; message: string }
> {
  if (binding.size > MAX_TEMPLATE_DISPLAY_ARCHIVE_BYTES)
    return { ok: false, status: 413, message: "Template inventory too large" };
  const blob = await storage.get(binding.storageId);
  if (!blob || blob.size !== binding.size)
    return { ok: false, status: 422, message: "Template inventory integrity mismatch" };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  try {
    const data = await verifiedInventory(bytes, binding.packageName, binding.version, {
      kind: "npm-pack",
      sha256: binding.sha256,
      npmIntegrity: binding.npmIntegrity,
      npmShasum: binding.npmShasum,
    });
    return { ok: true, data };
  } catch {
    return { ok: false, status: 422, message: "Template inventory could not be verified" };
  }
}
