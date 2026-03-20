import { api, internal } from "./_generated/api";

void internal.downloads.recordDownloadInternal;
void internal.soulDownloads.incrementInternal;

// @ts-expect-error download counters must not be publicly callable
void api.downloads.increment;

// @ts-expect-error soul download counters must not be publicly callable
void api.soulDownloads.increment;
