import { MAX_CLAWSCAN_NOTE_CHARS, normalizeClawScanNote } from "clawhub-schema";
import { ConvexError } from "convex/values";

export { MAX_CLAWSCAN_NOTE_CHARS };

export function normalizeClawScanNoteForWrite(value: string | null | undefined) {
  try {
    return normalizeClawScanNote(value);
  } catch (error) {
    throw new ConvexError(error instanceof Error ? error.message : "Invalid ClawScan note.");
  }
}
