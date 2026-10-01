export function pngResponse(png: Uint8Array, cacheControl: string) {
  const body = new ArrayBuffer(png.byteLength);
  new Uint8Array(body).set(png);
  return new Response(body, {
    headers: {
      "Cache-Control": cacheControl,
      "Content-Type": "image/png",
    },
  });
}
