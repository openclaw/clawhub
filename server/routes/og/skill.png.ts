import { defineEventHandler, getQuery, getRequestHost, setHeader } from "h3";
import { fetchImageDataUrl, fetchPublisherProfileImageDataUrl } from "../../og/fetchImageDataUrl";
import { fetchSkillOgMeta } from "../../og/fetchSkillOgMeta";
import { resolveOgDownloadsDisplay } from "../../og/formatOgStats";
import {
  ensureResvgWasm,
  getFontBuffers,
  getMarkDataUrl,
  getWatermarkDataUrl,
} from "../../og/ogAssets";
import { cleanString, getApiBase } from "../../og/ogRequest";
import { pngResponse } from "../../og/pngResponse";
import { buildOgDownloadsStat } from "../../og/registryOgSvg";
import { buildSkillOgSvg } from "../../og/skillOgSvg";

type OgQuery = {
  slug?: string;
  owner?: string;
  version?: string;
  title?: string;
  description?: string;
  downloads?: string;
  installs?: string;
  audit?: string;
  avatar?: string;
  v?: string;
};

export default defineEventHandler(async (event) => {
  const query = getQuery(event) as OgQuery;
  const slug = cleanString(query.slug);
  if (!slug) {
    setHeader(event, "Content-Type", "text/plain; charset=utf-8");
    return "Missing `slug` query param.";
  }

  const ownerFromQuery = cleanString(query.owner);
  const versionFromQuery = cleanString(query.version);
  const titleFromQuery = cleanString(query.title);
  const descriptionFromQuery = cleanString(query.description);
  const auditFromQuery = cleanString(query.audit);
  const avatarFromQuery = cleanString(query.avatar);

  const needFetch =
    !titleFromQuery || !descriptionFromQuery || !ownerFromQuery || !versionFromQuery;
  const meta = needFetch
    ? await fetchSkillOgMeta(slug, getApiBase(getRequestHost(event)), ownerFromQuery || undefined)
    : null;

  const owner = ownerFromQuery || meta?.owner || "";
  const version = versionFromQuery || meta?.version || "";
  const title = titleFromQuery || meta?.displayName || slug;
  const description = descriptionFromQuery || meta?.summary || "";

  const ownerLabel = owner ? `@${owner}` : "clawhub";
  const versionLabel = version ? `v${version}` : "latest";
  const auditLabel =
    auditFromQuery ||
    (meta?.moderation?.isMalwareBlocked || meta?.moderation?.verdict === "malicious"
      ? "Audit BLOCK"
      : meta?.moderation?.isSuspicious || meta?.moderation?.verdict === "suspicious"
        ? "Audit REVIEW"
        : "Audit PASS");

  const cacheKey = version ? "public, max-age=31536000, immutable" : "public, max-age=3600";
  const [markDataUrl, watermarkDataUrl, fontBuffers] = await Promise.all([
    getMarkDataUrl(),
    getWatermarkDataUrl(),
    ensureResvgWasm().then(() => getFontBuffers()),
  ]);
  const skillIconDataUrl = avatarFromQuery
    ? null
    : await fetchPublisherProfileImageDataUrl(meta?.icon);
  const avatarDataUrl = avatarFromQuery
    ? await fetchImageDataUrl(avatarFromQuery)
    : (skillIconDataUrl ?? (await fetchPublisherProfileImageDataUrl(meta?.ownerImage)));

  const svg = buildSkillOgSvg({
    markDataUrl,
    watermarkDataUrl,
    avatarDataUrl,
    avatarShape: skillIconDataUrl ? "rounded" : "circle",
    avatarFit: skillIconDataUrl ? "contain" : "cover",
    title,
    description,
    ownerLabel,
    versionLabel,
    installCommand: {
      subject: "skills",
      action: "install",
      target: slug,
    },
    stats: [
      buildOgDownloadsStat(resolveOgDownloadsDisplay(query, meta?.stats.downloads)),
      { value: auditLabel.replace(/^Audit\s+/i, ""), label: "Audit" },
    ],
  });

  return pngResponse(svg, fontBuffers, cacheKey, { mode: "width", value: 1200 });
});
