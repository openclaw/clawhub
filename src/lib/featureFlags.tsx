import { createKrillswitch } from "@openclaw/krillswitch-react";
import type { ReactNode } from "react";
import { FEATURE_FLAG_DEFAULTS, type FeatureFlagValues } from "./featureFlagManifest";
import { getRuntimeEnv } from "./runtimeEnv";

const DEFAULT_KRILLSWITCH_BASE_URL = "https://flags.openclaw.ai";
const krill = createKrillswitch(FEATURE_FLAG_DEFAULTS);

export type { FeatureFlagValues } from "./featureFlagManifest";
export const useFeatureFlag = krill.useFeatureFlag;

export function FeatureFlagProvider({
  baseUrl,
  children,
  contextKey,
  evalKey,
  initialValues,
  pollIntervalMs,
}: {
  baseUrl?: string;
  children: ReactNode;
  contextKey?: string;
  evalKey?: string;
  initialValues?: Partial<FeatureFlagValues> | null;
  pollIntervalMs?: number;
}) {
  const resolvedEvalKey = evalKey ?? getRuntimeEnv("VITE_KRILLSWITCH_EVAL_KEY");
  if (!resolvedEvalKey) return children;

  return (
    <krill.FeatureFlagProvider
      baseUrl={
        baseUrl ?? getRuntimeEnv("VITE_KRILLSWITCH_BASE_URL") ?? DEFAULT_KRILLSWITCH_BASE_URL
      }
      contextKey={contextKey}
      evalKey={resolvedEvalKey}
      initialValues={initialValues}
      pollIntervalMs={pollIntervalMs}
    >
      {children}
    </krill.FeatureFlagProvider>
  );
}
