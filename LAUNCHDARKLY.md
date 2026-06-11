# LaunchDarkly Setup

ClawHub uses LaunchDarkly for browser feature flags.

## SDK

- SDK package: `launchdarkly-react-client-sdk`
- SDK type: React Web, client-side
- Initialization file: `src/lib/featureFlagContext.tsx`
- Provider wiring: `src/components/AppProviders.tsx`
- Client-side ID env var: `VITE_LAUNCHDARKLY_CLIENT_SIDE_ID`

The client-side ID is not a secret, but it should still come from environment
configuration instead of being hardcoded in source.

## Current Flags

| App key | LaunchDarkly key | Default | Notes                                                                            |
| ------- | ---------------- | ------- | -------------------------------------------------------------------------------- |
| `souls` | `clawhub-souls`  | `false` | Controls public discovery links for Souls. The `/souls` route remains reachable. |

The LaunchDarkly flag lives in project `default`. It was created as a temporary
boolean flag with client-side SDK availability enabled. The `production` and
`test` environments are off by default.

## Code Conventions

Add flags in `src/lib/features.ts`:

```ts
export const featureFlags = {
  souls: {
    launchDarklyKey: "clawhub-souls",
    defaultValue: false,
  },
} as const satisfies Record<string, FeatureFlagDefinition>;
```

Read flags through `src/lib/featureFlagContext.tsx`:

```ts
const soulsEnabled = useFeatureFlag("souls");
```

For navigation/footer items, store the app-level flag key on the nav item and
filter with `useFeatureFlags()`. Do not import LaunchDarkly SDK hooks directly
from normal route or component code.

## Local Setup

Add this to `.env.local` when you want local browser evaluation against
LaunchDarkly:

```bash
VITE_LAUNCHDARKLY_CLIENT_SIDE_ID=<client-side-id>
```

Find the value in LaunchDarkly under the target project and environment:

```text
Project settings -> Environments -> SDK keys -> Client-side ID
```

If the env var is missing, ClawHub falls back to the defaults in
`src/lib/features.ts`.

## Agent Workflow

For future flag work, use the LaunchDarkly MCP tools when available:

- Create flags with client-side availability when browser code needs them.
- Keep safe fallback values in code.
- Leave temporary flags marked temporary until they are fully rolled out and
  removed from code.
- Archive flags only after checking code references and environment targeting.
