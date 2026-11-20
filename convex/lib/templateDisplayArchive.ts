import {
  templateBundledMetadataPaths,
  validateTemplatePackageContents,
  TEMPLATE_BOOTSTRAP_FILE_NAMES,
} from "clawhub-schema/templatePackage";
import type { ActionCtx } from "../_generated/server";
import { ClawPackTarLimitError, parseClawPack, sha256Hex } from "./clawpack";
import {
  MAX_TEMPLATE_DISPLAY_ARCHIVE_BYTES,
  MAX_TEMPLATE_DISPLAY_DATA_BYTES,
  type TemplateDisplayBinding,
  type TemplateDisplayData,
} from "./templateDisplayData";
import { retiredTemplateDisplayInput } from "./templateRetiredDisplay";
class InventorySizeLimitError extends Error {}
class RetiredTemplateGrammarError extends Error {}
type LegacyPreview = { profileCount: number; size: number; sha256: string };
const tooLarge = { ok: false, status: 413, message: "Template inventory too large" } as const;
async function verifiedInventory(
  bytes: Uint8Array,
  binding: TemplateDisplayBinding,
  legacyPreview?: LegacyPreview,
) {
  const { packageName, version } = binding;
  const pack = await parseClawPack(bytes, { maxTarBytes: 8 * 1024 * 1024, expected: binding });
  if (pack.packageName !== packageName || pack.packageVersion !== version)
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
  const paths = pack.entries.map((entry) => entry.path);
  function validate(text: string, ignored?: ReadonlySet<string>) {
    const markers = new Set([
      "BOOTSTRAP.md",
      ...templateBundledMetadataPaths(text, manifestPath, paths),
    ]);
    return validateTemplatePackageContents({
      packageName,
      version,
      packageJson: pack.packageJson,
      files: pack.entries
        .filter((entry) => !ignored?.has(entry.path))
        .map(({ path, bytes: entry }) => ({
          path,
          size: entry.length,
          ...(path === manifestPath
            ? { text }
            : markers.has(path)
              ? { text: utf8.decode(entry) }
              : {}),
        })),
    });
  }
  const checked = validate(manifestText);
  if (!checked.ok) {
    // Only the website's unpinned latest request can ask for this read-only diagnosis.
    // Recheck the rest of the package; a retired key must not mask unrelated errors.
    if (
      legacyPreview &&
      legacyPreview.size === manifestEntry.bytes.length &&
      legacyPreview.sha256 === (await sha256Hex(manifestEntry.bytes))
    ) {
      const old = retiredTemplateDisplayInput(manifestText, manifestPath, paths);
      if (
        old &&
        old.profiles.size === legacyPreview.profileCount &&
        validate(old.text, old.profiles).ok
      )
        throw new RetiredTemplateGrammarError();
    }
    throw Error("Invalid Template");
  }
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
    throw new InventorySizeLimitError();
  return data;
}

/** Only for trusted ingestion, bounded operator backfill, or the unprojected compatibility path. */
export async function readVerifiedTemplateDisplayArchive(
  storage: Pick<ActionCtx["storage"], "get">,
  binding: TemplateDisplayBinding,
  legacyPreview?: LegacyPreview,
): Promise<
  | { ok: true; data: TemplateDisplayData }
  | { ok: false; status: 413 | 422; message: string; retiredV1?: true }
> {
  if (binding.size > MAX_TEMPLATE_DISPLAY_ARCHIVE_BYTES) return tooLarge;
  const blob = await storage.get(binding.storageId);
  if (!blob || blob.size !== binding.size)
    return { ok: false, status: 422, message: "Template inventory integrity mismatch" };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  try {
    const data = await verifiedInventory(bytes, binding, legacyPreview);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ClawPackTarLimitError || error instanceof InventorySizeLimitError)
      return tooLarge;
    return {
      ok: false,
      status: 422,
      message: "Template inventory could not be verified",
      ...(error instanceof RetiredTemplateGrammarError ? { retiredV1: true as const } : {}),
    };
  }
}
