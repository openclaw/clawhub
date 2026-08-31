import { createKrillswitchEvaluator } from "@openclaw/krillswitch-react/server";
import { createServerFn } from "@tanstack/react-start";
import {
  FEATURE_FLAG_CONTEXT_KEY,
  FEATURE_FLAG_DEFAULTS,
  type FeatureFlagValues,
} from "./featureFlagManifest";
import { getRuntimeEnv } from "./runtimeEnv";

const DEFAULT_KRILLSWITCH_BASE_URL = "https://flags.openclaw.ai";
const SSR_EVALUATION_TIMEOUT_MS = 200;

const evaluateFlags = createKrillswitchEvaluator(FEATURE_FLAG_DEFAULTS);

export type InitialFeatureFlags = {
  values: FeatureFlagValues | null;
};

export async function evaluateInitialFeatureFlags(args: {
  baseUrl: string;
  evalKey: string;
  signal: AbortSignal;
}): Promise<FeatureFlagValues> {
  return await evaluateFlags({
    baseUrl: args.baseUrl,
    context: { key: FEATURE_FLAG_CONTEXT_KEY },
    evalKey: args.evalKey,
    signal: args.signal,
  });
}

export const loadInitialFeatureFlags = createServerFn({ method: "GET" }).handler(
  async (): Promise<InitialFeatureFlags> => {
    const evalKey = getRuntimeEnv("VITE_KRILLSWITCH_EVAL_KEY");
    if (!evalKey) return { values: null };

    try {
      const values = await evaluateInitialFeatureFlags({
        baseUrl: getRuntimeEnv("VITE_KRILLSWITCH_BASE_URL") ?? DEFAULT_KRILLSWITCH_BASE_URL,
        evalKey,
        signal: AbortSignal.timeout(SSR_EVALUATION_TIMEOUT_MS),
      });
      return { values };
    } catch (error) {
      console.warn("Krill Switch SSR evaluation failed; using code defaults.", error);
      return { values: null };
    }
  },
);
