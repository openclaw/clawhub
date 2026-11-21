import { defineEventHandler, getQuery, getRequestHost, setHeader } from "h3";
import { fetchImageDataUrl } from "../../og/fetchImageDataUrl";
import { fetchPluginOgMeta } from "../../og/fetchPluginOgMeta";
import { resolveOgDownloadsDisplay } from "../../og/formatOgStats";
import {
  ensureResvgWasm,
  getFontBuffers,
  getMarkDataUrl,
  getWatermarkDataUrl,
} from "../../og/ogAssets";
import { cleanString, getApiBase } from "../../og/ogRequest";
import { buildPluginOgSvg } from "../../og/pluginOgSvg";
import { pngResponse } from "../../og/pngResponse";
import { buildOgDownloadsStat } from "../../og/registryOgSvg";

type OgQuery = {
  name?: string;
  owner?: string;
  title?: string;
  description?: string;
  downloads?: string;
  installs?: string;
  audit?: string;
  avatar?: string;
  v?: string;
};

function getAuditLabel(status: string | null | undefined) {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "malicious") return "Audit BLOCK";
  if (normalized === "suspicious") return "Audit REVIEW";
  if (normalized === "clean" || normalized === "benign" || normalized === "pass") {
    return "Audit PASS";
  }
  if (normalized === "pending" || normalized === "not-run") return "Audit PENDING";
  return "Audit UNKNOWN";
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event) as OgQuery;
  const name = cleanString(query.name);
  if (!name) {
    setHeader(event, "Content-Type", "text/plain; charset=utf-8");
    return "Missing `name` query param.";
  }

  const ownerFromQuery = cleanString(query.owner);
  const titleFromQuery = cleanString(query.title);
  const descriptionFromQuery = cleanString(query.description);
  const auditFromQuery = cleanString(query.audit);
  const avatarFromQuery = cleanString(query.avatar);
  const needFetch = !ownerFromQuery || !titleFromQuery || !descriptionFromQuery;
  const meta = needFetch ? await fetchPluginOgMeta(name, getApiBase(getRequestHost(event))) : null;
  const packageName = meta?.name || name;
  const owner = ownerFromQuery || meta?.owner || "";
  const ownerLabel = owner ? `@${owner}` : "clawhub";
  const title = titleFromQuery || meta?.displayName || packageName;
  const description =
    descriptionFromQuery || meta?.summary || "OpenClaw plugin published on ClawHub.";

  const cacheKey = meta?.latestVersion
    ? "public, max-age=31536000, immutable"
    : "public, max-age=3600";
  const [markDataUrl, watermarkDataUrl, fontBuffers] = await Promise.all([
    getMarkDataUrl(),
    getWatermarkDataUrl(),
    ensureResvgWasm().then(() => getFontBuffers()),
  ]);
  const avatarDataUrl = await fetchImageDataUrl(avatarFromQuery || meta?.ownerImage);

  const svg = buildPluginOgSvg({
    markDataUrl,
    watermarkDataUrl,
    avatarDataUrl,
    title,
    description,
    packageName,
    ownerLabel,
    installCommand: {
      subject: "plugins",
      action: "install",
      target: `clawhub:${packageName}`,
    },
    stats: [
      buildOgDownloadsStat(resolveOgDownloadsDisplay(query, meta?.stats.downloads)),
      {
        value: (auditFromQuery || getAuditLabel(meta?.verification?.scanStatus)).replace(
          /^Audit\s+/i,
          "",
        ),
        label: "Audit",
      },
    ],
  });

  return pngResponse(svg, fontBuffers, cacheKey, { mode: "width", value: 1200 });
});
