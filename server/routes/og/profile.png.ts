import { Resvg } from "@resvg/resvg-wasm";
import { defineEventHandler, getQuery, setHeader } from "h3";
import { fetchImageDataUrl, fetchPublisherProfileImageDataUrl } from "../../og/fetchImageDataUrl";
import { fetchPublisherOgMeta } from "../../og/fetchPublisherOgMeta";
import { readOgDownloadsQuery, resolveOgDownloadsDisplay } from "../../og/formatOgStats";
import { normalizeOgLogoDataUrl } from "../../og/normalizeLogoDataUrl";
import {
  ensureResvgWasm,
  FONT_MONO,
  FONT_SANS,
  getClawHubLogoDataUrl,
  getPublisherFontBuffers,
} from "../../og/ogAssets";
import { pngResponse } from "../../og/pngResponse";
import { buildPublisherOgSvg } from "../../og/publisherOgSvg";
import { buildOgDownloadsStat } from "../../og/registryOgSvg";

type OgQuery = {
  handle?: string;
  title?: string;
  downloads?: string;
  installs?: string;
  kind?: string;
  official?: string;
  orgState?: string;
  orgImages?: string;
  avatar?: string;
  v?: string;
};

function cleanString(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function getConvexUrl() {
  return process.env.VITE_CONVEX_URL?.trim() || process.env.CONVEX_URL?.trim() || null;
}

function readBooleanQuery(value: unknown) {
  const raw = cleanString(value).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function readOrganizationImagesQuery(value: unknown) {
  const raw = cleanString(value);
  if (raw === "0") return [];
  return raw
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function readOrganizationStateQuery(value: unknown) {
  const raw = cleanString(value).toLowerCase();
  return raw !== "" && raw !== "0" && raw !== "false" && raw !== "none";
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event) as OgQuery;
  const handle = cleanString(query.handle).replace(/^@+/, "");
  if (!handle) {
    setHeader(event, "Content-Type", "text/plain; charset=utf-8");
    return "Missing `handle` query param.";
  }

  const titleFromQuery = cleanString(query.title);
  const kindFromQuery = cleanString(query.kind);
  const avatarFromQuery = cleanString(query.avatar);
  const organizationImagesFromQuery = readOrganizationImagesQuery(query.orgImages);
  const convexUrl = getConvexUrl();
  const requestsTrustedPublisherState =
    readBooleanQuery(query.official) ||
    readOrganizationStateQuery(query.orgState) ||
    organizationImagesFromQuery.length > 0;
  const needFetch =
    !titleFromQuery ||
    !readOgDownloadsQuery(query) ||
    !avatarFromQuery ||
    requestsTrustedPublisherState;
  const meta = needFetch && convexUrl ? await fetchPublisherOgMeta(handle, convexUrl) : null;
  const fetchedTrustedPublisherState =
    Boolean(meta?.official) || (meta?.affiliations.length ?? 0) > 0;
  const useVerifiedPublisherState =
    meta !== null && (requestsTrustedPublisherState || fetchedTrustedPublisherState);
  const verifiedMeta = useVerifiedPublisherState ? meta : null;
  const handleLabel = `@${meta?.handle || handle}`;
  const title = verifiedMeta
    ? verifiedMeta.displayName || handleLabel
    : titleFromQuery || meta?.displayName || handleLabel;
  const avatarUrl = verifiedMeta ? verifiedMeta.image : avatarFromQuery || meta?.image;
  const avatarKind = verifiedMeta ? verifiedMeta.kind : kindFromQuery || meta?.kind;
  const statsQuery = useVerifiedPublisherState ? {} : query;

  const [clawHubLogoDataUrl, fontBuffers] = await Promise.all([
    getClawHubLogoDataUrl(),
    ensureResvgWasm().then(() => getPublisherFontBuffers()),
  ]);
  const avatarDataUrl = await fetchPublisherProfileImageDataUrl(avatarUrl);
  const organizationImageUrls =
    verifiedMeta?.affiliations
      .map((affiliation) => affiliation.image)
      .filter(Boolean)
      .slice(0, 5) ?? [];
  const organizationCount = Math.min(verifiedMeta?.affiliations.length ?? 0, 5);
  const organizationLogoDataUrls = (
    await Promise.all(
      organizationImageUrls.map(async (imageUrl) => {
        const dataUrl = await fetchImageDataUrl(imageUrl, {
          allowPublicHttps: true,
          followRedirects: true,
        });
        return normalizeOgLogoDataUrl(dataUrl);
      }),
    )
  ).filter((imageUrl): imageUrl is string => Boolean(imageUrl));

  const svg = buildPublisherOgSvg({
    clawHubLogoDataUrl,
    avatarDataUrl,
    avatarShape: avatarKind === "org" ? "rounded" : "circle",
    official: verifiedMeta?.official ?? false,
    title,
    handleLabel,
    organizationCount,
    organizationLogos: organizationLogoDataUrls,
    stats: [buildOgDownloadsStat(resolveOgDownloadsDisplay(statsQuery, meta?.stats.downloads))],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
    font: {
      fontBuffers,
      defaultFontFamily: FONT_SANS,
      sansSerifFamily: FONT_SANS,
      monospaceFamily: FONT_MONO,
    },
  });
  const png = resvg.render().asPng();
  resvg.free();
  return pngResponse(png, "public, max-age=3600");
});
