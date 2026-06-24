import { Resvg } from "@resvg/resvg-wasm";
import { defineEventHandler, getQuery, setHeader } from "h3";
import { fetchPublisherProfileImageDataUrl } from "../../og/fetchImageDataUrl";
import { fetchPublisherOgMeta } from "../../og/fetchPublisherOgMeta";
import { readOgDownloadsQuery, resolveOgDownloadsDisplay } from "../../og/formatOgStats";
import {
  ensureResvgWasm,
  FONT_MONO,
  FONT_SANS,
  getFontBuffers,
  getMarkDataUrl,
  getWatermarkDataUrl,
} from "../../og/ogAssets";
import { pngResponse } from "../../og/pngResponse";
import { buildPublisherOgSvg } from "../../og/publisherOgSvg";
import { buildOgDownloadsStat } from "../../og/registryOgSvg";

type OgQuery = {
  handle?: string;
  title?: string;
  description?: string;
  downloads?: string;
  installs?: string;
  kind?: string;
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

export default defineEventHandler(async (event) => {
  const query = getQuery(event) as OgQuery;
  const handle = cleanString(query.handle).replace(/^@+/, "");
  if (!handle) {
    setHeader(event, "Content-Type", "text/plain; charset=utf-8");
    return "Missing `handle` query param.";
  }

  const titleFromQuery = cleanString(query.title);
  const descriptionFromQuery = cleanString(query.description);
  const kindFromQuery = cleanString(query.kind);
  const avatarFromQuery = cleanString(query.avatar);
  const convexUrl = getConvexUrl();
  const needFetch =
    !titleFromQuery || !descriptionFromQuery || !readOgDownloadsQuery(query) || !avatarFromQuery;
  const meta = needFetch && convexUrl ? await fetchPublisherOgMeta(handle, convexUrl) : null;
  const handleLabel = `@${meta?.handle || handle}`;
  const title = titleFromQuery || meta?.displayName || handleLabel;
  const description = descriptionFromQuery || meta?.bio || "Publisher on ClawHub.";

  const [markDataUrl, watermarkDataUrl, fontBuffers] = await Promise.all([
    getMarkDataUrl(),
    getWatermarkDataUrl(),
    ensureResvgWasm().then(() => getFontBuffers()),
  ]);
  const avatarDataUrl = await fetchPublisherProfileImageDataUrl(avatarFromQuery || meta?.image);

  const svg = buildPublisherOgSvg({
    markDataUrl,
    watermarkDataUrl,
    avatarDataUrl,
    avatarShape: kindFromQuery === "org" || meta?.kind === "org" ? "rounded" : "circle",
    title,
    description,
    handleLabel,
    stats: [buildOgDownloadsStat(resolveOgDownloadsDisplay(query, meta?.stats.downloads))],
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
