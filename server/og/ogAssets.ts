import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { initWasm } from "@resvg/resvg-wasm";

export const FONT_SANS = "Bricolage Grotesque";
export const FONT_MONO = "IBM Plex Mono";

type GlobalNitroMain = {
  __nitro_main__?: unknown;
};

let markDataUrlPromise: Promise<string> | null = null;
let clawHubLogoDataUrlPromise: Promise<string> | null = null;
let watermarkDataUrlPromise: Promise<string> | null = null;
let resvgWasmPromise: Promise<Uint8Array> | null = null;
let fontBuffersPromise: Promise<Uint8Array[]> | null = null;
let resvgInitPromise: Promise<void> | null = null;

function getServerRootUrl() {
  const nitroMain = (globalThis as unknown as GlobalNitroMain).__nitro_main__;
  if (typeof nitroMain === "string") {
    try {
      return new URL("./", nitroMain);
    } catch {
      // fall through
    }
  }
  return pathToFileURL(`${process.cwd()}/`);
}

function getServerUrl(pathname: string) {
  return new URL(pathname.replace(/^\//, ""), getServerRootUrl());
}

async function readFirstDataUrl(candidates: URL[]) {
  let lastError: unknown = null;
  for (const url of candidates) {
    try {
      const buffer = await readFile(url);
      return `data:image/png;base64,${buffer.toString("base64")}`;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function getClawHubLogoDataUrl() {
  if (!clawHubLogoDataUrlPromise) {
    clawHubLogoDataUrlPromise = readFirstDataUrl([
      getServerUrl("clawd-logo.png"),
      getServerUrl("public/clawd-logo.png"),
    ]);
  }
  return clawHubLogoDataUrlPromise;
}

export async function getMarkDataUrl() {
  if (!markDataUrlPromise) {
    markDataUrlPromise = readFirstDataUrl([
      getServerUrl("clawd-logo.png"),
      getServerUrl("public/clawd-logo.png"),
      getServerUrl("clawd-mark.png"),
      getServerUrl("public/clawd-mark.png"),
    ]);
  }
  return markDataUrlPromise;
}

export async function getWatermarkDataUrl() {
  if (!watermarkDataUrlPromise) {
    watermarkDataUrlPromise = readFirstDataUrl([
      getServerUrl("og-clawhub-watermark.png"),
      getServerUrl("public/og-clawhub-watermark.png"),
    ]);
  }
  return watermarkDataUrlPromise;
}

export async function getResvgWasm() {
  if (!resvgWasmPromise) {
    resvgWasmPromise = readFile(getServerUrl("node_modules/@resvg/resvg-wasm/index_bg.wasm")).then(
      (buffer) => new Uint8Array(buffer),
    );
  }
  return resvgWasmPromise;
}

export async function ensureResvgWasm() {
  if (!resvgInitPromise) {
    resvgInitPromise = getResvgWasm().then((wasm) => initWasm(wasm));
  }
  await resvgInitPromise;
}

export async function getFontBuffers() {
  if (!fontBuffersPromise) {
    fontBuffersPromise = Promise.all([
      readFile(
        getServerUrl(
          "node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff2",
        ),
      ),
      readFile(
        getServerUrl(
          "node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2",
        ),
      ),
      readFile(
        getServerUrl(
          "node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-500-normal.woff2",
        ),
      ),
      readFile(
        getServerUrl(
          "node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2",
        ),
      ),
      readFile(
        getServerUrl(
          "node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-800-normal.woff2",
        ),
      ),
      readFile(
        getServerUrl(
          "node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-500-normal.woff2",
        ),
      ),
    ]).then((buffers) => buffers.map((buffer) => new Uint8Array(buffer)));
  }
  return fontBuffersPromise;
}
