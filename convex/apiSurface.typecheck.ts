import { internal } from "./_generated/api";

// Asserts that the internal-only download counters remain internal-only.
// Public exposure is prevented at runtime by `internalMutation`; this file
// just pins the public references that *should* exist.
void internal.downloads.recordDownloadInternal;
void internal.soulDownloads.incrementInternal;
