import { isTextContentType, TEXT_FILE_EXTENSION_SET } from "clawhub-schema";
import { getUserFacingConvexError } from "../../lib/convexError";

export async function uploadFile(uploadUrl: string, file: File) {
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!response.ok) {
    throw new Error(`Upload failed: ${await response.text()}`);
  }
  const payload = (await response.json()) as { storageId: string };
  return payload.storageId;
}

export async function hashFile(file: File) {
  const buffer =
    typeof file.arrayBuffer === "function"
      ? await file.arrayBuffer()
      : await new Response(file).arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(buffer));
  const bytes = new Uint8Array(hash);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

export function formatPublishError(error: unknown) {
  return getUserFacingConvexError(error, "Publish failed. Please try again.");
}

export function isTextFile(file: File) {
  const path = (file.webkitRelativePath || file.name).trim().toLowerCase();
  if (!path) return false;
  const parts = path.split(".");
  const extension = parts.length > 1 ? (parts.at(-1) ?? "") : "";
  if (file.type && isTextContentType(file.type)) return true;
  if (extension && TEXT_FILE_EXTENSION_SET.has(extension)) return true;
  return false;
}

export async function readText(blob: Blob) {
  if (typeof (blob as Blob & { text?: unknown }).text === "function") {
    return (blob as Blob & { text: () => Promise<string> }).text();
  }
  return new Response(blob as BodyInit).text();
}
