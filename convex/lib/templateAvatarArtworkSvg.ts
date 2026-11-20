import { SaxesParser } from "saxes";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const shapes = new Set(["path", "rect", "circle", "ellipse", "line", "polygon", "polyline"]);
const numericAttributes = new Set([
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "stroke-width",
  "stroke-miterlimit",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
]);
const numberPattern = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?$/;

function reject(): never {
  throw new Error("Unsupported Template avatar SVG.");
}

function coordinate(value: string) {
  if (!numberPattern.test(value) || Math.abs(Number(value)) > 65536) reject();
  return Number(value);
}

function safeAttribute(key: string, value: string) {
  if (numericAttributes.has(key)) return Number.isFinite(coordinate(value));
  if (key === "d" || key === "points") {
    // Only geometry can reach the path parser; no CSS, transforms, URLs or resource graph.
    if (value.length > 8192 || !/^[MmZzLlHhVvCcSsQqTtAaEe.,+\d\s-]+$/.test(value)) return false;
    const numbers = value.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
    return (
      numbers.length > 0 &&
      numbers.length <= 2048 &&
      numbers.every((n) => Number.isFinite(coordinate(n)))
    );
  }
  if (key === "fill" || key === "stroke" || key === "color")
    return /^(?:#[\da-f]{3,8}|[a-z]{1,24})$/i.test(value);
  if (key === "fill-rule") return /^(?:nonzero|evenodd)$/.test(value);
  if (key === "stroke-linecap") return /^(?:butt|round|square)$/.test(value);
  if (key === "stroke-linejoin") return /^(?:round|miter|bevel)$/.test(value);
  return false;
}

/** Translate a small, bounded, resource-free vector language to a fresh SVG. Never pass
 * publisher XML to the native renderer, even after inspecting it. Unknown syntax fails closed. */
export function staticTemplateAvatarSvg(
  bytes: Uint8Array,
  maxPixels: number,
  outputSide: number,
): string {
  if (bytes.length > 64 * 1024) reject();
  const parser = new SaxesParser({ xmlns: false } as const);
  const output: string[] = [];
  const stack: string[] = [];
  let elements = 0;
  let drewShape = false;
  parser.on("doctype", reject);
  parser.on("processinginstruction", reject);
  parser.on("cdata", reject);
  parser.on("text", (text) => {
    if (text.trim()) reject();
  });
  parser.on("opentag", ({ name, attributes }) => {
    if (++elements > 256 || stack.length > 12) reject();
    const parent = stack.at(-1);
    if (!parent) {
      if (name !== "svg" || (attributes.xmlns !== undefined && attributes.xmlns !== SVG_NAMESPACE))
        reject();
      const box = attributes.viewBox
        ?.trim()
        .split(/[\s,]+/)
        .map(coordinate);
      if (box && (box.length !== 4 || box[2] < 1 || box[3] < 1)) reject();
      const width = attributes.width === undefined ? box?.[2] : coordinate(attributes.width);
      const height = attributes.height === undefined ? box?.[3] : coordinate(attributes.height);
      if (
        !width ||
        !height ||
        width < 1 ||
        height < 1 ||
        width * height > maxPixels ||
        width > 8192 ||
        height > 8192
      )
        reject();
      // Bound the native render surface itself, not just a later thumbnail resize.
      const scale = Math.min(1, outputSide / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      const viewBox = (box ?? [0, 0, width, height]).join(" ");
      output.push(`<svg xmlns="${SVG_NAMESPACE}" width="${w}" height="${h}" viewBox="${viewBox}"`);
    } else {
      if ((parent !== "svg" && parent !== "g") || (name !== "g" && !shapes.has(name))) reject();
      drewShape ||= shapes.has(name);
      output.push("<" + name);
    }
    for (const [key, value] of Object.entries(attributes)) {
      if (key === "role" || key === "aria-label" || key === "aria-hidden") continue;
      if (!parent && ["xmlns", "viewBox", "width", "height"].includes(key)) continue;
      if (!safeAttribute(key, value)) reject();
      // Only the closed value alphabets above are serialized. None includes XML delimiters.
      output.push(" " + key + '="' + value + '"');
    }
    output.push(">");
    stack.push(name);
  });
  parser.on("closetag", ({ name }) => {
    output.push("</" + name + ">");
    stack.pop();
  });
  parser.write(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).close();
  if (!drewShape) reject();
  return output.join("");
}
