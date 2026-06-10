type FeatureFlagDefinition = {
  launchDarklyKey: string;
  defaultValue: boolean;
};

export const featureFlags = {
  souls: {
    launchDarklyKey: "clawhub-souls",
    defaultValue: false,
  },
} as const satisfies Record<string, FeatureFlagDefinition>;

export type FeatureFlagKey = keyof typeof featureFlags;
export type FeatureFlagValues = { [Key in FeatureFlagKey]: boolean };

export function getFeatureFlagFallback(key: FeatureFlagKey): boolean {
  return featureFlags[key].defaultValue;
}

export function getFeatureFlagFallbacks(): FeatureFlagValues {
  return {
    souls: getFeatureFlagFallback("souls"),
  };
}

export function resolveBooleanFeatureFlag(
  key: FeatureFlagKey,
  remoteValue: boolean | undefined,
): boolean {
  return typeof remoteValue === "boolean" ? remoteValue : getFeatureFlagFallback(key);
}
