import { LDProvider, useFlags, useLDClient, type LDContext } from "launchdarkly-react-client-sdk";
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  featureFlags,
  getFeatureFlagFallback,
  getFeatureFlagFallbacks,
  resolveBooleanFeatureFlag,
  type FeatureFlagKey,
  type FeatureFlagValues,
} from "./features";
import { getRuntimeEnv } from "./runtimeEnv";
import { useAuthStatus } from "./useAuthStatus";

const FeatureFlagContext = createContext<FeatureFlagValues>(getFeatureFlagFallbacks());

type LaunchDarklyConfig = {
  clientSideID: string;
};

function getLaunchDarklyConfig(): LaunchDarklyConfig | null {
  const clientSideID = getRuntimeEnv("VITE_LAUNCHDARKLY_CLIENT_SIDE_ID");
  if (!clientSideID) return null;
  return { clientSideID };
}

export function FeatureFlagProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => getLaunchDarklyConfig(), []);

  if (!config) {
    return (
      <FeatureFlagContext.Provider value={getFeatureFlagFallbacks()}>
        {children}
      </FeatureFlagContext.Provider>
    );
  }

  return (
    <LDProvider
      clientSideID={config.clientSideID}
      context={createAnonymousLaunchDarklyContext()}
      flags={{
        [featureFlags.souls.launchDarklyKey]: getFeatureFlagFallback("souls"),
      }}
      reactOptions={{ useCamelCaseFlagKeys: false, sendEventsOnFlagRead: false }}
      options={{ sendEventsOnlyForVariation: true }}
      timeout={5}
    >
      <LaunchDarklyBackedFeatureFlagProvider>{children}</LaunchDarklyBackedFeatureFlagProvider>
    </LDProvider>
  );
}

function LaunchDarklyBackedFeatureFlagProvider({ children }: { children: ReactNode }) {
  const flags = useFlags<Record<string, unknown>>();
  const souls = flags[featureFlags.souls.launchDarklyKey];
  const values = useMemo<FeatureFlagValues>(
    () => ({
      souls: resolveBooleanFeatureFlag("souls", typeof souls === "boolean" ? souls : undefined),
    }),
    [souls],
  );

  return (
    <FeatureFlagContext.Provider value={values}>
      <LaunchDarklyIdentity />
      {children}
    </FeatureFlagContext.Provider>
  );
}

function LaunchDarklyIdentity() {
  const launchDarkly = useLDClient();
  const { isAuthenticated, isLoading, me } = useAuthStatus();
  const identifiedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!launchDarkly) return;
    if (isLoading) return;

    if (!isAuthenticated || !me) {
      if (identifiedUserIdRef.current) {
        void launchDarkly.identify(createAnonymousLaunchDarklyContext());
        identifiedUserIdRef.current = null;
      }
      return;
    }

    if (identifiedUserIdRef.current === me._id) return;
    void launchDarkly.identify({
      kind: "user",
      key: me._id,
      role: me.role ?? "user",
    });
    identifiedUserIdRef.current = me._id;
  }, [isAuthenticated, isLoading, launchDarkly, me]);

  return null;
}

export function createAnonymousLaunchDarklyContext(): LDContext {
  return { kind: "user", anonymous: true };
}

export function useFeatureFlag(key: FeatureFlagKey): boolean {
  return useContext(FeatureFlagContext)[key];
}

export function useFeatureFlags(): FeatureFlagValues {
  return useContext(FeatureFlagContext);
}
