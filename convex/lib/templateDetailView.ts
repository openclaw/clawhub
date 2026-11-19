import { isSafeTemplatePackagePath } from "clawhub-schema/templatePaths";
import { decodeUtf8Text } from "clawhub-schema/textFiles";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { sha256Hex } from "./hash";
import { json, text } from "./httpHeaders";
import { toPackageMetadataResponse, type PublicPackageDocLike } from "./packageReadProjection";
import { isPublishedPackageRelease } from "./packageReleaseVisibility";
import { getPackageDownloadSecurityBlock, isPackageBlockedFromPublic } from "./packageSecurity";
import type { PublicPublisher } from "./public";
import { MAX_RAW_FILE_BYTES, readBoundedPackageBlob } from "./storageText";

type Release = Doc<"packageReleases">;
type TemplateDetailRelease = {
  version: string;
  llmAnalysis: NonNullable<Release["llmAnalysis"]> | null;
  file: Pick<Release["files"][number], "size" | "sha256" | "storageId"> | null;
};
export type TemplateDetailSelection = {
  tags: Record<string, string>;
  release: TemplateDetailRelease | null;
};

export function isTemplateDetailRequest(request: Request) {
  return new URL(request.url).searchParams.get("view") === "template-detail";
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Internal only: authorize before selecting even a storage handle. */
export function selectTemplateDetailRelease(
  pkg: PublicPackageDocLike,
  release: Release | null,
): TemplateDetailRelease | null {
  if (
    pkg.family !== "template" ||
    !isPublishedPackageRelease(release, pkg._id) ||
    release._id !== pkg.latestReleaseId ||
    release.version !== pkg.latestVersion
  )
    return null;

  // The ordinary package/owner metadata still observes owner visibility. This
  // website-only expansion never embeds private or blocked release data.
  if (
    pkg.channel === "private" ||
    isPackageBlockedFromPublic(pkg.scanStatus) ||
    getPackageDownloadSecurityBlock(release)
  ) {
    return { version: release.version, file: null, llmAnalysis: null };
  }

  // Publish stores the package.json it validated against the uploaded bytes. Do
  // not guess a root path or use /file's case-insensitive alias on old records.
  const envelope: unknown = release.extractedPackageJson;
  if (
    !record(envelope) ||
    envelope.name !== pkg.name ||
    envelope.version !== release.version ||
    !record(envelope.openclaw) ||
    Object.hasOwn(envelope.openclaw, "claw")
  )
    return null;
  const path = envelope.openclaw.template;
  if (
    typeof path !== "string" ||
    path.split("/").at(-1) !== "CLAW.md" ||
    !isSafeTemplatePackagePath(path)
  )
    return null;
  const entry = release.files.find((file) => file.path === path);
  return {
    version: release.version,
    llmAnalysis: release.llmAnalysis ?? null,
    file: entry ? { size: entry.size, sha256: entry.sha256, storageId: entry.storageId } : null,
  };
}

/** Only this allowlist crosses HTTP. Storage errors propagate rather than
 * masquerading as a missing document in an otherwise successful response. */
export async function templateDetailViewResponse(
  ctx: ActionCtx,
  pkg: PublicPackageDocLike,
  owner: PublicPublisher | null,
  selection: TemplateDetailSelection,
  headers: HeadersInit,
) {
  const metadata = toPackageMetadataResponse(pkg, owner, selection.tags);
  const { release } = selection;
  if (!release) return json(metadata, 200, headers);
  let contents: string | null = null;
  if (release.file) {
    const file = release.file;
    const result = await readBoundedPackageBlob(ctx, file, MAX_RAW_FILE_BYTES);
    if (result.status === 413) return text(result.message, result.status, headers);
    if (result.status === 200) {
      if (result.blob.size !== file.size)
        return text("Template preview integrity mismatch", 503, headers);
      const bytes = new Uint8Array(await result.blob.arrayBuffer());
      if ((await sha256Hex(bytes)) !== file.sha256)
        return text("Template preview integrity mismatch", 503, headers);
      contents = decodeUtf8Text(bytes);
    }
  }
  return json(
    {
      ...metadata,
      templateRelease: { version: release.version, contents, llmAnalysis: release.llmAnalysis },
    },
    200,
    headers,
  );
}
