---
summary: "Create your first OpenClaw plugin in minutes"
title: "Building plugins"
sidebarTitle: "Getting Started"
doc-schema-version: 1
read_when:
  - You want to create a new OpenClaw plugin
  - You need a quick-start for plugin development
  - You are choosing between channel, provider, CLI backend, tool, or hook docs
---

Plugins extend OpenClaw without changing core. A plugin can add a messaging
channel, model provider, local CLI backend, agent tool, hook, media provider,
or another plugin-owned capability.

You do not need to add an external plugin to the OpenClaw repository. Publish
the package to [ClawHub](../publishing.md) and users install it with:

```bash
openclaw plugins install clawhub:@myorg/openclaw-my-plugin
```

Bare package specs still install from npm during the launch cutover. Use the
`clawhub:` prefix when you want ClawHub resolution.

## Requirements

- Use Node 22.19 or newer and a package manager such as `npm` or `pnpm`.
- Be familiar with TypeScript ESM modules.

<Note>
  OpenClaw contributors working on bundled plugins use the OpenClaw repository's
  `pnpm` workspace and `extensions/*` test lanes. External ClawHub publishers
  should use their plugin repository's package manager and test scripts.
</Note>

## Choose the plugin shape

<CardGroup cols={2}>
  <Card title="Channel plugin" icon="messages-square" href="./sdk-channel-plugins.md">
    Connect OpenClaw to a messaging platform.
  </Card>
  <Card title="Provider plugin" icon="cpu" href="./sdk-provider-plugins.md">
    Add a model, media, search, fetch, speech, or realtime provider.
  </Card>
  <Card title="CLI backend plugin" icon="terminal" href="./cli-backend-plugins.md">
    Run a local AI CLI through OpenClaw model fallback.
  </Card>
  <Card title="Tool plugin" icon="wrench" href="./tool-plugins.md">
    Register agent tools.
  </Card>
</CardGroup>

## Quickstart

Build a minimal tool plugin by registering one required agent tool. This is the
shortest useful plugin shape and shows the package, manifest, entry point, and
local proof.

<Steps>
  <Step title="Create package metadata">
    <CodeGroup>

```json package.json
{
  "name": "@myorg/openclaw-my-plugin",
  "version": "1.0.0",
  "type": "module",
  "files": ["dist", "openclaw.plugin.json"],
  "scripts": {
    "build": "tsc -p tsconfig.json"
  },
  "openclaw": {
    "extensions": ["./index.ts"],
    "runtimeExtensions": ["./dist/index.js"],
    "compat": {
      "pluginApi": ">=2026.5.17",
      "minGatewayVersion": "2026.5.17"
    },
    "build": {
      "openclawVersion": "2026.6.6",
      "pluginSdkVersion": "2026.6.6"
    }
  },
  "dependencies": {
    "typebox": "^1.1.38"
  },
  "peerDependencies": {
    "openclaw": ">=2026.5.17"
  },
  "devDependencies": {
    "openclaw": "^2026.6.6",
    "typescript": "^5.9.0"
  }
}
```

```json openclaw.plugin.json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "Adds a custom tool to OpenClaw",
  "contracts": {
    "tools": ["my_tool"]
  },
  "activation": {
    "onStartup": true
  },
  "configSchema": {
    "type": "object",
    "additionalProperties": false
  }
}
```

```json tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["index.ts"]
}
```

    </CodeGroup>

    The build script emits `dist/index.js`, and `runtimeExtensions` tells
    installed OpenClaw instances to load that built JavaScript. ClawHub rejects
    a published package that declares only a TypeScript source entry without a
    matching built runtime file. See [SDK entry points](./sdk-entrypoints.md)
    for the full entry point contract.

    Every plugin needs a manifest, even when it has no config. Runtime tools
    must appear in `contracts.tools` so OpenClaw can discover ownership without
    eagerly loading every plugin runtime. Set `activation.onStartup`
    intentionally. This example starts on Gateway startup.

    For every manifest field, see [Plugin manifest](./manifest.md).

  </Step>

  <Step title="Register the tool">
    ```typescript index.ts
    import { Type } from "typebox";
    import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

    export default defineToolPlugin({
      id: "my-plugin",
      name: "My Plugin",
      description: "Adds a custom tool to OpenClaw",
      tools: (tool) => [
        tool({
          name: "my_tool",
          description: "Echo one input value",
          parameters: Type.Object({ input: Type.String() }),
          execute: ({ input }) => ({ received: input }),
        }),
      ],
    });
    ```

    Use `defineToolPlugin` for a fixed set of tools. Use `definePluginEntry`
    for mixed-capability or dynamically registered plugins. Channel plugins use
    `defineChannelPluginEntry`.

  </Step>

  <Step title="Build and test the runtime">
    Install dependencies, build the runtime artifact, and run ClawHub's bundled
    Plugin Inspector from the plugin package root:

    ```bash
    npm install
    npm run build
    clawhub package validate .
    ```

    Run your package's unit and integration tests before publishing. Add the
    repository's test command to this gate once tests are configured.

    Add the direct Inspector package to your repository when you want repeatable
    checks, runtime capture, SARIF, JUnit, and report artifacts in CI. See
    [Plugin Inspector](../plugin-inspector.md).

    For an installed or external plugin, inspect the loaded runtime:

    ```bash
    openclaw plugins inspect my-plugin --runtime --json
    ```

    If the plugin registers a CLI command, run that command too. For example,
    a demo command should have an execution proof such as
    `openclaw demo-plugin ping`.

    OpenClaw contributors working on a bundled plugin in the OpenClaw repository
    should also run the closest targeted workspace tests:

    ```bash
    pnpm test -- extensions/my-plugin/
    pnpm check
    ```

  </Step>

  <Step title="Publish">
    Validate the package before publishing:

    ```bash
    npm run build
    clawhub package validate .
    clawhub package publish . --family code-plugin --dry-run
    clawhub package publish . --family code-plugin
    ```

    See [ClawHub publishing](../publishing.md) for owner scopes, source
    attribution, trusted publishing, and review behavior.

  </Step>

  <Step title="Install">
    Install the published package through ClawHub:

    ```bash
    openclaw plugins install clawhub:@myorg/openclaw-my-plugin
    ```

  </Step>
</Steps>

<a id="registering-agent-tools"></a>

## Registering tools

Tools can be required or optional. Required tools are always available when the
plugin is enabled. Optional tools require user opt-in.

```typescript
register(api) {
  api.registerTool(
    {
      name: "workflow_tool",
      description: "Run a workflow",
      parameters: Type.Object({ pipeline: Type.String() }),
      async execute(_id, params) {
        return { content: [{ type: "text", text: params.pipeline }] };
      },
    },
    { optional: true },
  );
}
```

Every tool registered with `api.registerTool(...)` must also be declared in the
plugin manifest:

```json
{
  "contracts": {
    "tools": ["workflow_tool"]
  },
  "toolMetadata": {
    "workflow_tool": {
      "optional": true
    }
  }
}
```

Users opt in with `tools.allow`:

```json5
{
  tools: { allow: ["workflow_tool"] }, // or ["my-plugin"] for all tools from one plugin
}
```

Optional tools control whether a tool is exposed to the model. Use
[plugin permission requests](./plugin-permission-requests.md) when a tool
or hook should ask for approval after the model selects it and before the
action runs.

Use optional tools for side effects, unusual binaries, or capabilities that
should not be exposed by default. Tool names must not conflict with core tools;
conflicts are skipped and reported in plugin diagnostics. Malformed
registrations, including tool descriptors without `parameters`, are skipped and
reported the same way. Registered tools are typed functions the model can call
after policy and allowlist checks pass.

Tool factories receive a runtime-supplied context object. Use `ctx.activeModel`
when a tool needs to log, display, or adapt to the active model for the current
turn. The object can include `provider`, `modelId`, and `modelRef`. Treat it as
informational runtime metadata, not as a security boundary against the local
operator, installed plugin code, or a modified OpenClaw runtime. Sensitive local
tools should still require an explicit plugin or operator opt-in and fail closed
when active-model metadata is missing or unsuitable.

The manifest declares ownership and discovery; execution still calls the live
registered tool implementation. Keep `toolMetadata.<tool>.optional: true`
aligned with `api.registerTool(..., { optional: true })` so OpenClaw can avoid
loading that plugin runtime until the tool is explicitly allowlisted.

## Import conventions

Import from focused SDK subpaths:

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
```

Do not import from the deprecated root barrel:

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk";
```

Within your plugin package, use local barrel files such as `api.ts` and
`runtime-api.ts` for internal imports. Do not import your own plugin through an
SDK path. Provider-specific helpers should stay in the provider package unless
the seam is truly generic.

Custom Gateway RPC methods are an advanced entry point. Keep them on a
plugin-specific prefix; core admin namespaces such as `config.*`,
`exec.approvals.*`, `operator.admin.*`, `wizard.*`, and `update.*` stay reserved
and resolve to `operator.admin`. The
`openclaw/plugin-sdk/gateway-method-runtime` bridge is reserved for plugin HTTP
routes that declare `contracts.gatewayMethodDispatch: ["authenticated-request"]`.

For the full import map, see [Plugin SDK overview](./sdk-overview.md).

## Pre-submission checklist

- **package.json** has correct `openclaw` metadata
- **openclaw.plugin.json** manifest is present and valid
- Entry point uses the appropriate public helper: `defineToolPlugin`,
  `defineChannelPluginEntry`, or `definePluginEntry`
- Built JavaScript runtime files match `openclaw.runtimeExtensions`
- All imports use focused `plugin-sdk/<subpath>` paths
- Internal imports use local modules, not SDK self-imports
- Your package's unit and integration tests pass
- `clawhub package validate .` passes
- `clawhub package publish . --family code-plugin --dry-run` resolves the
  expected package metadata and source attribution
- For OpenClaw bundled plugins, the relevant `pnpm` tests and `pnpm check` pass

## Test against beta releases

This is OpenClaw release coordination, not a ClawHub publishing requirement.
External plugin authors can use it to catch SDK and runtime regressions before
an OpenClaw stable release.

1. Watch for GitHub release tags on [openclaw/openclaw](https://github.com/openclaw/openclaw/releases) and subscribe via `Watch` > `Releases`. Beta tags look like `v2026.3.N-beta.1`. You can also turn on notifications for the official OpenClaw X account [@openclaw](https://x.com/openclaw) for release announcements.
2. Test your plugin against the beta tag as soon as it appears. The window before stable is typically only a few hours.
3. Post in your plugin's thread in the `plugin-forum` Discord channel after testing with either `all good` or what broke. If you do not have a thread yet, create one.
4. If something breaks, open or update an issue titled `Beta blocker: <plugin-name> - <summary>` and apply the `beta-blocker` label. Put the issue link in your thread.
5. Open a PR to `main` titled `fix(<plugin-id>): beta blocker - <summary>` and link the issue in both the PR and your Discord thread. Contributors cannot label PRs, so the title is the PR-side signal for maintainers and automation. Blockers with a PR get merged; blockers without one might ship anyway. Maintainers watch these threads during beta testing.
6. Silence means green. If you miss the window, your fix likely lands in the next cycle.

## Next steps

<CardGroup cols={2}>
  <Card title="Channel Plugins" icon="messages-square" href="./sdk-channel-plugins.md">
    Build a messaging channel plugin
  </Card>
  <Card title="Provider Plugins" icon="cpu" href="./sdk-provider-plugins.md">
    Build a model provider plugin
  </Card>
  <Card title="CLI Backend Plugins" icon="terminal" href="./cli-backend-plugins.md">
    Register a local AI CLI backend
  </Card>
  <Card title="SDK Overview" icon="book-open" href="./sdk-overview.md">
    Import map and registration API reference
  </Card>
  <Card title="Runtime Helpers" icon="settings" href="./sdk-runtime.md">
    TTS, search, subagent via api.runtime
  </Card>
  <Card title="Testing" icon="test-tubes" href="./sdk-testing.md">
    Test utilities and patterns
  </Card>
  <Card title="Plugin Manifest" icon="file-json" href="./manifest.md">
    Full manifest schema reference
  </Card>
</CardGroup>

## Related

- [Plugin hooks](./hooks.md)
- [Plugin architecture](https://docs.openclaw.ai/plugins/architecture)
