import { Resvg } from "@resvg/resvg-wasm";
import type { ApiV1PackageResponse } from "clawhub-schema";
import { defineEventHandler, getQuery } from "h3";
import { serverFetch } from "nitro/app";
import sharp from "sharp";
import { tryNormalizePackageName } from "../../../convex/lib/packageReadName";
import { isHostedSkillPresentationIconPath } from "../../../convex/lib/skillPresentation";
import { normalizePublisherHandle } from "../../../src/lib/templateRoutes";
import { getTemplateShareCopy } from "../../../src/lib/templateShare";
import { readLimitedImageBody } from "../../og/fetchImageDataUrl";
import {
  ensureResvgWasm,
  FONT_MONO,
  FONT_SANS,
  getFontBuffers,
  getMarkDataUrl,
} from "../../og/ogAssets";
import { withOgFetchTimeout } from "../../og/ogFetchTimeout";
import { cleanString } from "../../og/ogRequest";
import { pngResponse } from "../../og/pngResponse";
import { buildTemplateOgSvg } from "../../og/templateOgSvg";

async function loadArtwork(icon: string | null | undefined) {
  if (!icon || !isHostedSkillPresentationIconPath(icon)) return null;
  try {
    // Only the registry's content-addressed assets, never a publisher-supplied URL.
    const bytes = await withOgFetchTimeout(async (signal) => {
      const response = await serverFetch(icon.trim(), { signal, credentials: "omit" });
      if (
        !response.ok ||
        response.headers.get("content-type")?.split(";")[0]?.trim() !== "image/png"
      )
        return null;
      return readLimitedImageBody(response);
    });
    if (!bytes) return null;
    const png = await sharp(bytes, { limitInputPixels: 4_000_000 })
      .resize(282, 282, { fit: "inside", kernel: "nearest" })
      .png()
      .toBuffer();
    return "data:image/png;base64," + png.toString("base64");
  } catch {
    return null;
  }
}

function unavailable(status: number) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const name = tryNormalizePackageName(cleanString(query.name));
  const owner = normalizePublisherHandle(cleanString(query.owner));
  if (!name || !owner) return unavailable(400);

  // Read through the same public registry as the page, without the requester's credentials.
  // A cached share URL is not authority to render a removed or newly private package.
  let detail: ApiV1PackageResponse | null;
  try {
    detail = await withOgFetchTimeout(async (signal) => {
      const response = await serverFetch("/api/v1/packages/" + encodeURIComponent(name), {
        signal,
        credentials: "omit",
        headers: { Accept: "application/json" },
      });
      if ([401, 403, 404].includes(response.status)) return null;
      if (!response.ok) throw new Error("Registry unavailable");
      return (await response.json()) as ApiV1PackageResponse;
    });
  } catch {
    return unavailable(503);
  }
  const pkg = detail?.package;
  const handle = detail?.owner?.handle;
  if (
    !pkg ||
    pkg.family !== "template" ||
    (pkg.channel !== "official" && pkg.channel !== "community") ||
    pkg.name !== name ||
    !handle ||
    normalizePublisherHandle(handle) !== owner
  )
    return unavailable(404);
  const [artwork, mark, fontBuffers] = await Promise.all([
    loadArtwork(pkg.icon),
    getMarkDataUrl(),
    ensureResvgWasm().then(getFontBuffers),
  ]);
  const svg = buildTemplateOgSvg({
    ...getTemplateShareCopy(pkg),
    owner: handle.trim().replace(/^@+/, ""),
    mark,
    artwork,
  });
  const renderer = new Resvg(svg, {
    font: {
      fontBuffers,
      defaultFontFamily: FONT_SANS,
      sansSerifFamily: FONT_SANS,
      monospaceFamily: FONT_MONO,
    },
  });
  try {
    const image = renderer.render();
    try {
      // Copy and visibility can change without a new release: never cache immutably.
      return pngResponse(image.asPng(), "public, max-age=3600");
    } finally {
      image.free();
    }
  } finally {
    renderer.free();
  }
});
