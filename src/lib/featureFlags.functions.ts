import { createKrillswitchEvaluator } from "@openclaw/krillswitch-react/server";
import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { FEATURE_FLAG_DEFAULTS, type FeatureFlagValues } from "./featureFlagManifest";
import { getRuntimeEnv, isDevRuntime } from "./runtimeEnv";

const DEFAULT_KRILLSWITCH_BASE_URL = "https://flags.openclaw.ai";
const FEATURE_FLAG_CONTEXT_COOKIE = "clawhub-feature-flag-context";
const FEATURE_FLAG_CONTEXT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const SSR_EVALUATION_TIMEOUT_MS = 200;

const evaluateFlags = createKrillswitchEvaluator(FEATURE_FLAG_DEFAULTS);

type InitialFeatureFlags = {
  contextKey: string;
  values: FeatureFlagValues | null;
};

function getOrCreateContextKey(): string {
  const existing = getCookie(FEATURE_FLAG_CONTEXT_COOKIE)?.trim();
  if (existing) return existing;

  const contextKey = `anon-${crypto.randomUUID()}`;
  setCookie(FEATURE_FLAG_CONTEXT_COOKIE, contextKey, {
    httpOnly: true,
    maxAge: FEATURE_FLAG_CONTEXT_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: !isDevRuntime(),
  });
  return contextKey;
}

export async function evaluateInitialFeatureFlags(args: {
  baseUrl: string;
  contextKey: string;
  evalKey: string;
  signal: AbortSignal;
}): Promise<FeatureFlagValues> {
  return await evaluateFlags({
    baseUrl: args.baseUrl,
    context: { key: args.contextKey },
    evalKey: args.evalKey,
    signal: args.signal,
  });
}

export const loadInitialFeatureFlags = createServerFn({ method: "GET" }).handler(
  async (): Promise<InitialFeatureFlags> => {
    const contextKey = getOrCreateContextKey();
    const evalKey = getRuntimeEnv("VITE_KRILLSWITCH_EVAL_KEY");
    if (!evalKey) return { contextKey, values: null };

    try {
      const values = await evaluateInitialFeatureFlags({
        baseUrl: getRuntimeEnv("VITE_KRILLSWITCH_BASE_URL") ?? DEFAULT_KRILLSWITCH_BASE_URL,
        contextKey,
        evalKey,
        signal: AbortSignal.timeout(SSR_EVALUATION_TIMEOUT_MS),
      });
      return { contextKey, values };
    } catch (error) {
      console.warn("Krill Switch SSR evaluation failed; using code defaults.", error);
      return { contextKey, values: null };
    }
  },
);
