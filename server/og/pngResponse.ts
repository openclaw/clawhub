import { Resvg, type ResvgRenderOptions } from "@resvg/resvg-wasm";
import { FONT_MONO, FONT_SANS } from "./ogAssets";

export function pngResponse(
  svg: string,
  fontBuffers: Uint8Array[],
  cacheControl: string,
  fitTo?: ResvgRenderOptions["fitTo"],
) {
  const renderer = new Resvg(svg, {
    ...(fitTo ? { fitTo } : {}),
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
      const png = image.asPng();
      const body = new ArrayBuffer(png.byteLength);
      new Uint8Array(body).set(png);
      return new Response(body, {
        headers: {
          "Cache-Control": cacheControl,
          "Content-Type": "image/png",
        },
      });
    } finally {
      image.free();
    }
  } finally {
    renderer.free();
  }
}
