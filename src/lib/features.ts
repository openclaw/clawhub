import { getRuntimeEnv } from "./runtimeEnv";

/**
 * Feature flags — controlled via VITE_FEATURE_* env vars.
 * Default values are the fallback when the env var is unset.
 */

function flag(name: string, defaultValue: boolean): boolean {
  const raw = getRuntimeEnv(name);
  if (raw === undefined) return defaultValue;
  return raw === "true" || raw === "1";
}

/** Show the Souls section (nav, footer, homepage category, routes). Default: false */
export const FEATURE_SOULS = flag("VITE_FEATURE_SOULS", false);
