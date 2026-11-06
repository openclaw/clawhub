import { gzipSync } from "fflate";

const BLOCK_SIZE = 512;

function octal(value: number, width: number) {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

function writeString(target: Uint8Array, offset: number, width: number, value: string) {
  const encoded = new TextEncoder().encode(value);
  target.set(encoded.subarray(0, width), offset);
}

function tarFile(path: string, content: string | Uint8Array) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const header = new Uint8Array(BLOCK_SIZE);
  writeString(header, 0, 100, path);
  writeString(header, 100, 8, octal(0o644, 8));
  writeString(header, 108, 8, octal(0, 8));
  writeString(header, 116, 8, octal(0, 8));
  writeString(header, 124, 12, octal(bytes.byteLength, 12));
  writeString(header, 136, 12, octal(0, 12));
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeString(header, 257, 6, "ustar");
  writeString(header, 263, 2, "00");

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeString(header, 148, 8, octal(checksum, 8));

  const paddedSize = Math.ceil(bytes.byteLength / BLOCK_SIZE) * BLOCK_SIZE;
  const body = new Uint8Array(paddedSize);
  body.set(bytes);
  return [header, body];
}

export function npmPackFixtureEntries(files: Array<[string, string | Uint8Array]>) {
  const parts: Uint8Array[] = [];
  for (const [path, content] of files) {
    parts.push(...tarFile(path, content));
  }
  parts.push(new Uint8Array(BLOCK_SIZE), new Uint8Array(BLOCK_SIZE));
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const tar = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    tar.set(part, offset);
    offset += part.byteLength;
  }
  return gzipSync(tar);
}

export function npmPackFixture(files: Record<string, string | Uint8Array>) {
  return npmPackFixtureEntries(Object.entries(files));
}
