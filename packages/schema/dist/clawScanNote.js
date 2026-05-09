export const MAX_CLAWSCAN_NOTE_CHARS = 4000;
export function normalizeClawScanNote(value) {
    const trimmed = value?.trim() ?? "";
    if (!trimmed)
        return undefined;
    if (trimmed.length > MAX_CLAWSCAN_NOTE_CHARS) {
        throw new Error(`ClawScan note must be at most ${MAX_CLAWSCAN_NOTE_CHARS} characters.`);
    }
    return trimmed;
}
//# sourceMappingURL=clawScanNote.js.map