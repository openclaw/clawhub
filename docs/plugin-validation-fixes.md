---
summary: "Fix ClawHub plugin package validation findings before publishing"
read_when:
  - You ran clawhub package validate and need to fix plugin findings
  - ClawHub rejected or warned on a plugin package publish
  - You are updating plugin package metadata before release
title: "Plugin validation fixes"
---

# Plugin validation fixes

ClawHub validates plugin packages before publish and can also show findings from
automated package scans. This page covers author-facing findings, which means
findings the plugin author can fix in their package metadata, manifest, SDK
imports, or published artifact.

It does not cover internal Plugin Inspector coverage findings. If a full report
contains scanner maintenance codes without author remediation guidance, those
are for OpenClaw maintainers rather than plugin authors.

After applying any fix, rerun:

```bash
clawhub package validate <path-to-plugin>
```

## Author-facing findings

| Code                                    | Start here                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `package-json-missing`                  | [Add package metadata](./plugin-validation-fixes.md#package-json-missing)                                                   |
| `package-openclaw-metadata-missing`     | [Add the package openclaw block](./plugin-validation-fixes.md#package-openclaw-metadata-missing)                            |
| `package-openclaw-entry-missing`        | [Declare OpenClaw package entrypoints](./plugin-validation-fixes.md#package-openclaw-entry-missing)                         |
| `package-entrypoint-missing`            | [Publish the declared entrypoint](./plugin-validation-fixes.md#package-entrypoint-missing)                                  |
| `package-install-metadata-incomplete`   | [Complete install metadata](./plugin-validation-fixes.md#package-install-metadata-incomplete)                               |
| `package-plugin-api-compat-missing`     | [Declare plugin API compatibility](./plugin-validation-fixes.md#package-plugin-api-compat-missing)                          |
| `package-min-host-version-drift`        | [Align minimum host version](./plugin-validation-fixes.md#package-min-host-version-drift)                                   |
| `package-manifest-version-drift`        | [Align package and manifest versions](./plugin-validation-fixes.md#package-manifest-version-drift)                          |
| `package-openclaw-unsupported-metadata` | [Remove unsupported OpenClaw package metadata](./plugin-validation-fixes.md#package-openclaw-unsupported-metadata)          |
| `package-npm-pack-unavailable`          | [Make the npm artifact packable](./plugin-validation-fixes.md#package-npm-pack-unavailable)                                 |
| `package-npm-pack-entrypoint-missing`   | [Include entrypoints in npm pack output](./plugin-validation-fixes.md#package-npm-pack-entrypoint-missing)                  |
| `package-npm-pack-metadata-missing`     | [Include metadata in npm pack output](./plugin-validation-fixes.md#package-npm-pack-metadata-missing)                       |
| `manifest-name-missing`                 | [Add a manifest display name](./plugin-validation-fixes.md#manifest-name-missing)                                           |
| `manifest-unknown-fields`               | [Remove unsupported manifest fields](./plugin-validation-fixes.md#manifest-unknown-fields)                                  |
| `manifest-unknown-contracts`            | [Remove unsupported contract keys](./plugin-validation-fixes.md#manifest-unknown-contracts)                                 |
| `legacy-root-sdk-import`                | [Replace root SDK imports](./plugin-validation-fixes.md#legacy-root-sdk-import)                                             |
| `reserved-sdk-import`                   | [Remove reserved SDK imports](./plugin-validation-fixes.md#reserved-sdk-import)                                             |
| `sdk-load-session-store`                | [Replace whole-session-store access](./plugin-validation-fixes.md#sdk-load-session-store)                                   |
| `sdk-session-store-write`               | [Replace whole-session-store writes](./plugin-validation-fixes.md#sdk-session-store-write)                                  |
| `sdk-session-file-helper`               | [Replace session file-path helpers](./plugin-validation-fixes.md#sdk-session-file-helper)                                   |
| `sdk-session-transcript-file-target`    | [Replace legacy transcript file targets](./plugin-validation-fixes.md#sdk-session-transcript-file-target)                   |
| `sdk-session-transcript-low-level`      | [Replace low-level transcript helpers](./plugin-validation-fixes.md#sdk-session-transcript-low-level)                       |
| `legacy-before-agent-start`             | [Replace before_agent_start](./plugin-validation-fixes.md#legacy-before-agent-start)                                        |
| `provider-auth-env-vars`                | [Move provider env vars to setup metadata](./plugin-validation-fixes.md#provider-auth-env-vars)                             |
| `channel-env-vars`                      | [Mirror channel env vars in current metadata](./plugin-validation-fixes.md#channel-env-vars)                                |
| `security-manifest-schema-unavailable`  | [Remove unavailable security manifest schema references](./plugin-validation-fixes.md#security-manifest-schema-unavailable) |
| `unrecognized-security-manifest`        | [Remove unsupported security manifest files](./plugin-validation-fixes.md#unrecognized-security-manifest)                   |

## Package metadata

### package-json-missing

The package root does not include `package.json`, so ClawHub cannot identify the
npm package, version, entrypoints, or OpenClaw metadata.

- Add `package.json` with `name`, `version`, and `type`.
- Add an `openclaw` block when the package ships an OpenClaw plugin.
- Use [Building plugins](/plugins/building-plugins) for a minimal package
  example and [Plugin manifest](/plugins/manifest#manifest-versus-packagejson)
  for the package versus manifest split.
- Rerun `clawhub package validate <path-to-plugin>`.

### package-openclaw-metadata-missing

The package has `package.json`, but it does not declare OpenClaw package
metadata.

- Add `package.json#openclaw`.
- Include entrypoint metadata such as `openclaw.extensions` or
  `openclaw.runtimeExtensions`.
- Add compatibility and install metadata when the package will be published or
  installed through ClawHub.
- See [package.json fields that affect discovery](/plugins/manifest#packagejson-fields-that-affect-discovery).
- Rerun `clawhub package validate <path-to-plugin>`.

### package-openclaw-entry-missing

The package metadata exists, but it does not declare an OpenClaw runtime
entrypoint.

- Add `openclaw.extensions` for native plugin entrypoints.
- Add `openclaw.runtimeExtensions` when the published package should load built
  JavaScript.
- Keep all entrypoint paths inside the package directory.
- See [Plugin entry points](/plugins/sdk-entrypoints) and
  [package.json fields that affect discovery](/plugins/manifest#packagejson-fields-that-affect-discovery).
- Rerun `clawhub package validate <path-to-plugin>`.

### package-entrypoint-missing

The package declares an OpenClaw entrypoint, but the referenced file is missing
from the package being validated.

- Check each path in `openclaw.extensions`, `openclaw.runtimeExtensions`,
  `openclaw.setupEntry`, and `openclaw.runtimeSetupEntry`.
- Build the package if the entrypoint is generated into `dist`.
- Update the metadata if the entrypoint moved.
- See [Plugin entry points](/plugins/sdk-entrypoints).
- Rerun `clawhub package validate <path-to-plugin>`.

### package-install-metadata-incomplete

ClawHub cannot tell how the package should be installed or updated.

- Fill `openclaw.install` with the supported install source, such as
  `clawhubSpec`, `npmSpec`, or `localPath`.
- Set `openclaw.install.defaultChoice` when more than one install source is
  available.
- Use `openclaw.install.minHostVersion` for the minimum OpenClaw host version.
- See [package.json fields that affect discovery](/plugins/manifest#packagejson-fields-that-affect-discovery).
- Rerun `clawhub package validate <path-to-plugin>`.

### package-plugin-api-compat-missing

The package does not declare the OpenClaw plugin API range it supports.

- Add `openclaw.compat.pluginApi` to `package.json`.
- Use the OpenClaw plugin API version or semver floor that you built and tested
  against.
- Keep this separate from the package version. The package version describes the
  plugin release; `openclaw.compat.pluginApi` describes the host API contract.
- See [package.json fields that affect discovery](/plugins/manifest#packagejson-fields-that-affect-discovery).
- Rerun `clawhub package validate <path-to-plugin>`.

### package-min-host-version-drift

The package minimum host version does not match the OpenClaw version metadata
the package was built against.

- Check `openclaw.install.minHostVersion`.
- Check any OpenClaw build metadata in the package, such as the OpenClaw version
  used during release.
- Align the minimum host version with the host version range the package
  actually supports.
- See [package.json fields that affect discovery](/plugins/manifest#packagejson-fields-that-affect-discovery).
- Rerun `clawhub package validate <path-to-plugin>`.

### package-manifest-version-drift

The package version and plugin manifest version disagree.

- Prefer `package.json#version` as the package release version.
- If `openclaw.plugin.json` also has `version`, update it to match or remove
  stale manifest version metadata when package metadata is authoritative.
- Publish a new package version after changing published metadata.
- See [Plugin manifest](/plugins/manifest).
- Rerun `clawhub package validate <path-to-plugin>`.

### package-openclaw-unsupported-metadata

The `package.json#openclaw` block contains fields that are not supported
OpenClaw package metadata.

- Remove unsupported fields such as `openclaw.bundle`.
- Keep native plugin metadata in `openclaw.plugin.json`.
- Keep package entrypoints, compatibility, install, setup, and catalog metadata
  in supported `package.json#openclaw` fields.
- See [package.json fields that affect discovery](/plugins/manifest#packagejson-fields-that-affect-discovery).
- Rerun `clawhub package validate <path-to-plugin>`.

## Published artifact

### package-npm-pack-unavailable

The package cannot be packed into the artifact ClawHub would inspect or
publish.

- Run `npm pack --dry-run` from the package root.
- Fix invalid package metadata, broken lifecycle scripts, or files entries that
  make packing fail.
- Remove `private: true` if this package is intended for public publishing.
- Rerun `clawhub package validate <path-to-plugin>`.

### package-npm-pack-entrypoint-missing

The package can be packed, but the packed artifact does not include the
entrypoint files declared in `package.json#openclaw`.

- Run `npm pack --dry-run` and inspect the files that would be included.
- Build generated entrypoints before packing.
- Update `files`, `.npmignore`, or build output so declared entrypoints are
  included.
- See [Plugin entry points](/plugins/sdk-entrypoints).
- Rerun `clawhub package validate <path-to-plugin>`.

### package-npm-pack-metadata-missing

The packed artifact is missing OpenClaw metadata that exists in your source
package.

- Run `npm pack --dry-run` and inspect the included metadata files.
- Ensure `package.json` includes the `openclaw` block in the packed artifact.
- Ensure `openclaw.plugin.json` is included when the package is a native
  OpenClaw plugin.
- Update `files` or `.npmignore` so package metadata is not excluded.
- See [Building plugins](/plugins/building-plugins).
- Rerun `clawhub package validate <path-to-plugin>`.

## Manifest metadata

### manifest-name-missing

The native plugin manifest does not include a display name.

- Add a non-empty `name` field to `openclaw.plugin.json`.
- Keep `name` human-readable and keep `id` as the stable machine id.
- See [Plugin manifest](/plugins/manifest).
- Rerun `clawhub package validate <path-to-plugin>`.

### manifest-unknown-fields

The plugin manifest has top-level fields that OpenClaw does not support.

- Compare each top-level field with the
  [manifest field reference](/plugins/manifest#top-level-field-reference).
- Remove custom fields from `openclaw.plugin.json`.
- Move package or install metadata into supported `package.json#openclaw` fields
  instead of the manifest.
- Rerun `clawhub package validate <path-to-plugin>`.

### manifest-unknown-contracts

The manifest declares unsupported keys inside `contracts`.

- Compare each key under `contracts` with the
  [contracts reference](/plugins/manifest#contracts-reference).
- Remove unsupported contract keys.
- Move runtime behavior into plugin registration code, and keep `contracts`
  limited to static capability ownership metadata.
- Rerun `clawhub package validate <path-to-plugin>`.

## SDK and compatibility migration

### legacy-root-sdk-import

The plugin imports from the deprecated root SDK barrel:
`openclaw/plugin-sdk`.

- Replace root-barrel imports with focused public subpath imports.
- Use `openclaw/plugin-sdk/plugin-entry` for `definePluginEntry`.
- Use `openclaw/plugin-sdk/channel-core` for channel entry helpers.
- Use [Import conventions](/plugins/building-plugins#import-conventions) and
  [Plugin SDK subpaths](/plugins/sdk-subpaths) to find the narrow import.
- Rerun `clawhub package validate <path-to-plugin>`.

### reserved-sdk-import

The plugin imports an SDK path reserved for bundled plugins or internal
compatibility.

- Replace reserved OpenClaw internal SDK imports with documented public
  `openclaw/plugin-sdk/*` subpaths.
- If the behavior has no public SDK, keep the helper inside your package or
  request a public OpenClaw API.
- Use [Plugin SDK subpaths](/plugins/sdk-subpaths) and
  [SDK migration](/plugins/sdk-migration) to choose a supported import.
- Rerun `clawhub package validate <path-to-plugin>`.

### sdk-load-session-store

The plugin still uses the deprecated whole-session-store helper
`loadSessionStore`.

- Use `getSessionEntry(...)` or `listSessionEntries(...)` when reading session
  state.
- Use `patchSessionEntry(...)` or `upsertSessionEntry(...)` when writing session
  state.
- Avoid loading, mutating, and saving the whole session store object.
- Keep `loadSessionStore(...)` only while your declared compatibility range
  still supports older OpenClaw versions that require it.
- See [Runtime API](/plugins/sdk-runtime#agent-session-state) and
  [Plugin SDK subpaths](/plugins/sdk-subpaths).
- Rerun `clawhub package validate <path-to-plugin>`.

### sdk-session-store-write

The plugin still uses a deprecated whole-session-store write helper such as
`saveSessionStore` or `updateSessionStore`.

- Use `patchSessionEntry(...)` when updating fields on an existing session
  entry.
- Use `upsertSessionEntry(...)` when replacing or creating a session entry.
- Avoid loading, mutating, and saving the whole session store object.
- Keep whole-store write helpers only while your declared compatibility range
  still supports older OpenClaw versions that require them.
- See [Runtime API](/plugins/sdk-runtime#agent-session-state) and
  [Plugin SDK subpaths](/plugins/sdk-subpaths).
- Rerun `clawhub package validate <path-to-plugin>`.

### sdk-session-file-helper

The plugin still uses deprecated session file-path helpers such as
`resolveSessionFilePath` or `resolveAndPersistSessionFile`.

- Use `getSessionEntry(...)` to read session metadata by agent and session
  identity.
- Use `patchSessionEntry(...)` or `upsertSessionEntry(...)` to persist session
  metadata.
- Use transcript identity or target helpers when the code is preparing a
  transcript operation.
- Do not persist or depend on legacy transcript file paths.
- See [Runtime API](/plugins/sdk-runtime#agent-session-state) and
  [Plugin SDK subpaths](/plugins/sdk-subpaths).
- Rerun `clawhub package validate <path-to-plugin>`.

### sdk-session-transcript-file-target

The plugin still uses the deprecated transcript file target helper
`resolveSessionTranscriptLegacyFileTarget`.

- Use `resolveSessionTranscriptIdentity(...)` when the code only needs public
  session identity.
- Use `resolveSessionTranscriptTarget(...)` when the code needs a structured
  transcript operation target.
- Avoid reading or constructing legacy transcript file targets directly.
- Keep the legacy helper only while your declared compatibility range still
  supports older OpenClaw versions that require it.
- See [Runtime API](/plugins/sdk-runtime#agent-session-state) and
  [Plugin SDK subpaths](/plugins/sdk-subpaths).
- Rerun `clawhub package validate <path-to-plugin>`.

### sdk-session-transcript-low-level

The plugin still uses deprecated low-level transcript helpers such as
`appendSessionTranscriptMessage` or `emitSessionTranscriptUpdate`.

- Use `appendSessionTranscriptMessageByIdentity(...)` for transcript appends.
- Use `publishSessionTranscriptUpdateByIdentity(...)` for transcript update
  notifications.
- Prefer the structured transcript runtime surface so OpenClaw can apply the
  correct transaction boundaries and identity handling.
- Keep low-level transcript helpers only while your declared compatibility range
  still supports older OpenClaw versions that require them.
- See [Runtime API](/plugins/sdk-runtime#agent-session-state) and
  [Plugin SDK subpaths](/plugins/sdk-subpaths).
- Rerun `clawhub package validate <path-to-plugin>`.

### legacy-before-agent-start

The plugin still uses the legacy `before_agent_start` hook.

- Move model or provider override work to `before_model_resolve`.
- Move prompt or context mutation work to `before_prompt_build`.
- Keep `before_agent_start` only while your declared compatibility range still
  supports older OpenClaw versions that require it.
- See [Hooks](/plugins/hooks) and
  [Plugin compatibility](/plugins/compatibility).
- Rerun `clawhub package validate <path-to-plugin>`.

### provider-auth-env-vars

The manifest still uses legacy `providerAuthEnvVars` provider auth metadata.

- Mirror provider env-var metadata into `setup.providers[].envVars`.
- Keep `providerAuthEnvVars` only as compatibility metadata while your supported
  OpenClaw range still needs it.
- See [setup reference](/plugins/manifest#setup-reference) and
  [SDK migration](/plugins/sdk-migration).
- Rerun `clawhub package validate <path-to-plugin>`.

### channel-env-vars

The manifest uses legacy or older channel env-var metadata without the current
setup or config metadata ClawHub expects.

- Keep channel env-var metadata declarative so OpenClaw can inspect setup status
  without loading channel runtime.
- Mirror env-driven channel setup into the current setup, channel config, or
  package channel metadata used by your plugin shape.
- Keep `channelEnvVars` only as compatibility metadata while older supported
  OpenClaw versions still require it.
- See [Plugin manifest](/plugins/manifest) and
  [Channel plugins](/plugins/sdk-channel-plugins).
- Rerun `clawhub package validate <path-to-plugin>`.

## Security manifest

### security-manifest-schema-unavailable

The package ships `openclaw.security.json` with a schema reference that ClawHub
does not recognize as available.

- Remove the schema URL if it is advisory-only.
- Use a documented versioned schema only after OpenClaw publishes one.
- Rerun `clawhub package validate <path-to-plugin>`.

### unrecognized-security-manifest

The package ships an unsupported security manifest file.

- Remove `openclaw.security.json` until OpenClaw documents a versioned security
  manifest schema and ClawHub behavior.
- Keep security-sensitive behavior documented in your public package docs or
  README until the manifest contract exists.
- Rerun `clawhub package validate <path-to-plugin>`.

## Related

- [ClawHub CLI](./cli.md)
- [ClawHub publishing](./publishing.md)
- [Building plugins](/plugins/building-plugins)
- [Plugin manifest](/plugins/manifest)
- [Plugin entry points](/plugins/sdk-entrypoints)
- [Plugin compatibility](/plugins/compatibility)
