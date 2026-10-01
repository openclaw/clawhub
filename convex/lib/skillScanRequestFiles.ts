import type { Doc } from "../_generated/dataModel";

export const MAX_SKILL_SCAN_REQUEST_FILE_CHUNK_BYTES = 256 * 1024;
export const MAX_SKILL_SCAN_REQUEST_FILES_PER_CHUNK = 100;
export const MAX_SKILL_SCAN_REQUEST_FILE_CHUNKS = 100;
export const MAX_SKILL_SCAN_REQUEST_MANIFEST_BYTES = 4 * 1024 * 1024;

export function serializedSkillScanRequestFilesBytes(files: Doc<"skillScanRequests">["files"]) {
  return new TextEncoder().encode(JSON.stringify(files)).byteLength;
}

export function chunkSkillScanRequestFiles(files: Doc<"skillScanRequests">["files"]) {
  const chunks: Array<Doc<"skillScanRequests">["files"]> = [];
  let current: Doc<"skillScanRequests">["files"] = [];
  let currentBytes = 2;
  let manifestBytes = 0;
  const pushCurrent = () => {
    if (current.length === 0) return;
    manifestBytes += serializedSkillScanRequestFilesBytes(current);
    if (
      chunks.length >= MAX_SKILL_SCAN_REQUEST_FILE_CHUNKS ||
      manifestBytes > MAX_SKILL_SCAN_REQUEST_MANIFEST_BYTES
    ) {
      throw new Error("Skill scan file manifest metadata exceeds the hydration limit");
    }
    chunks.push(current);
    current = [];
    currentBytes = 2;
  };
  for (const file of files) {
    const fileBytes = new TextEncoder().encode(JSON.stringify(file)).byteLength + 1;
    if (fileBytes + 2 > MAX_SKILL_SCAN_REQUEST_FILE_CHUNK_BYTES) {
      throw new Error("Skill scan file metadata entry exceeds the chunk limit");
    }
    if (
      current.length > 0 &&
      (current.length >= MAX_SKILL_SCAN_REQUEST_FILES_PER_CHUNK ||
        currentBytes + fileBytes > MAX_SKILL_SCAN_REQUEST_FILE_CHUNK_BYTES)
    ) {
      pushCurrent();
    }
    current.push(file);
    currentBytes += fileBytes;
  }
  pushCurrent();
  return chunks;
}
