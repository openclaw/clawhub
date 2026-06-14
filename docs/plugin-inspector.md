---
summary: "Use Plugin Inspector during OpenClaw plugin development, testing, and CI"
title: "Plugin Inspector"
read_when:
  - You are validating an OpenClaw plugin before publishing
  - You want compatibility checks in a plugin repository
  - You need Plugin Inspector reports, SARIF, or JUnit output in CI
---

# Plugin Inspector

[OpenClaw Plugin Inspector](https://github.com/openclaw/plugin-inspector) is an
offline compatibility checker for OpenClaw plugin packages. It inspects package
metadata, `openclaw.plugin.json`, SDK imports, hooks, registration calls, and
declared contracts before a plugin reaches users.

ClawHub bundles Plugin Inspector in its CLI. Start with the ClawHub command when
you want author-facing findings and the same validation path used during
publishing:

```bash
clawhub package validate .
```

The default check is static, offline, and credential-free. Hard compatibility
breakages exit non-zero. Warnings remain visible without failing the command.

## Development workflow

Use Plugin Inspector alongside unit tests and runtime proof:

1. Build the JavaScript runtime that the package will publish.
2. Run `clawhub package validate .` while changing metadata, manifests, SDK
   imports, hooks, or registrations.
3. Run your plugin's unit and integration tests.
4. Use runtime capture when static inspection cannot prove registrations made by
   `register(api)`.
5. Run a ClawHub publish dry run before release.

```bash
npm run build
clawhub package validate .
npm test
clawhub package validate . --runtime --allow-execute
clawhub package publish . --family code-plugin --dry-run
```

Runtime capture imports plugin code in an isolated workspace. The ClawHub
command uses a mocked OpenClaw SDK by default. Only pass `--runtime
--allow-execute` for code you trust and intend to execute.

Plugin Inspector complements, but does not replace:

- unit and integration tests for plugin behavior
- `openclaw plugins inspect <plugin-id> --runtime --json` against an installed
  plugin
- live tests for provider, channel, network, or service behavior
- a ClawHub publish dry run

## Add repeatable scripts

Install Plugin Inspector directly when a plugin repository needs stable local
scripts and CI independent of the ClawHub CLI:

```bash
npm install --save-dev @openclaw/plugin-inspector
```

Add separate static and runtime scripts so code execution stays explicit:

```json package.json
{
  "scripts": {
    "plugin:check": "plugin-inspector check --no-openclaw",
    "plugin:ci": "plugin-inspector ci --no-openclaw",
    "plugin:ci:runtime": "plugin-inspector ci --no-openclaw --runtime --mock-sdk --allow-execute"
  }
}
```

Use `plugin:check` in the normal development loop. Run `plugin:ci` on every pull
request. Add `plugin:ci:runtime` when runtime registration capture provides
useful proof and the CI job only executes trusted repository code.

You can also preview and generate starter scripts, config, and a GitHub Actions
workflow:

```bash
npx @openclaw/plugin-inspector init --ci --scripts --dry-run
npx @openclaw/plugin-inspector init --ci --scripts
```

## Assert expected registrations

Add Plugin Inspector config when the plugin must expose specific registration
surfaces. Small repositories can keep it in `package.json`:

```json package.json
{
  "pluginInspector": {
    "version": 1,
    "plugin": {
      "id": "my-plugin",
      "expect": {
        "registrations": ["registerTool"]
      }
    }
  }
}
```

Use expectations for required plugin contracts, not optional behavior. Inspect
the resolved config before adding it to CI:

```bash
plugin-inspector config --json
```

## GitHub Actions

`plugin-inspector ci` writes the normal compatibility report plus CI summary,
SARIF, and JUnit artifacts. A minimal static workflow is:

```yaml
name: plugin-inspector

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run plugin:ci
      - uses: actions/upload-artifact@v5
        if: always()
        with:
          name: plugin-inspector-reports
          path: reports/plugin-inspector-*
```

Run the runtime script in a separate trusted-code job or step when needed:

```yaml
- run: npm run plugin:ci:runtime
```

## Reports and findings

The normal check writes:

- `reports/plugin-inspector-report.json`
- `reports/plugin-inspector-report.md`
- `reports/plugin-inspector-issues.md`

The `ci` command also writes CI summary, SARIF, and JUnit output. Keep these
artifacts when a check fails so reviewers can inspect the evidence.

ClawHub publish validation also runs Plugin Inspector. Local and CI checks catch
the same class of author-facing problems earlier; publish-time validation
remains the final registry gate. Use [Plugin validation fixes](./plugin-validation-fixes.md)
to remediate common findings.

For the complete command surface, configuration schema, runtime-capture model,
and public API, see the
[Plugin Inspector repository](https://github.com/openclaw/plugin-inspector).
