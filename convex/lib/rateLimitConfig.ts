export const RATE_LIMIT_WINDOW_MS = 60_000;
// Keep enough shards to spread bursty writes while limiting per-window row growth.
export const RATE_LIMIT_COUNTER_SHARDS = 16;
