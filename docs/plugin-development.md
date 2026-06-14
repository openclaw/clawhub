---
summary: "Build, validate, and publish OpenClaw plugins through ClawHub."
read_when:
  - Building an OpenClaw plugin for ClawHub
  - Choosing a plugin shape or SDK entry point
  - Fixing plugin validation or compatibility findings
title: "Plugin development"
---

# Plugin development

ClawHub is the registry and publishing surface for OpenClaw plugins. These
guides bring the public OpenClaw plugin-authoring contract next to ClawHub's
package validation, publishing, security, and release documentation.

Start with [Building plugins](./plugins/building-plugins.md). It covers the
smallest working package, manifest, entry point, local validation, and ClawHub
publish flow.

## Authoring path

1. Choose the plugin shape and build a minimal package.
2. Declare the OpenClaw package and manifest metadata ClawHub validates before
   publication.
3. Import focused public SDK entry points instead of OpenClaw internals.
4. Test against the OpenClaw versions declared by the package.
5. Run Plugin Inspector locally and in CI.
6. Run a publish dry run.
7. Publish a new immutable package version.

## Start here

- [Building plugins](./plugins/building-plugins.md): first plugin tutorial and
  pre-submission checklist.
- [Plugin Inspector](./plugin-inspector.md): local compatibility checks, runtime
  capture, reports, and CI.
- [Tool plugins](./plugins/tool-plugins.md): simple typed agent tools.
- [Channel plugins](./plugins/sdk-channel-plugins.md): messaging platform
  integrations.
- [Provider plugins](./plugins/sdk-provider-plugins.md): model and capability
  providers.
- [CLI backend plugins](./plugins/cli-backend-plugins.md): local AI CLI
  backends.
- [Plugin bundles](./plugins/bundles.md): bundle layouts and current ClawHub
  distribution limits.
- [Plugin manifest](./plugins/manifest.md): `openclaw.plugin.json` and
  `package.json#openclaw` reference.
- [Plugin SDK overview](./plugins/sdk-overview.md): registration API and import
  map.
- [Plugin entry points](./plugins/sdk-entrypoints.md): entry helpers and loading
  modes.
- [Plugin SDK subpaths](./plugins/sdk-subpaths.md): supported focused imports.
- [Plugin runtime helpers](./plugins/sdk-runtime.md): helpers injected into
  plugin registration.
- [Plugin setup and config](./plugins/sdk-setup.md): setup entries, config
  schemas, and package metadata.
- [Plugin testing](./plugins/sdk-testing.md): testing patterns and utilities.
- [Plugin hooks](./plugins/hooks.md): agent, tool, message, session, and Gateway
  lifecycle hooks.
- [Plugin permission requests](./plugins/plugin-permission-requests.md):
  approval prompts for plugin-owned actions.
- [Plugin compatibility](./plugins/compatibility.md): compatibility and
  deprecation expectations.
- [Plugin validation fixes](./plugin-validation-fixes.md): ClawHub validation
  finding remediation.

## Documentation ownership

ClawHub owns package publishing, validation, source provenance, scan state,
moderation, and registry behavior. OpenClaw owns the runtime plugin API.

The runtime guides in this section are mirrored from a pinned OpenClaw
documentation revision so plugin authors can follow one path from development
through ClawHub publication. OpenClaw remains canonical for runtime and SDK
behavior. If a mirrored page conflicts with current OpenClaw behavior, use the
[OpenClaw documentation](https://docs.openclaw.ai) and report the stale
ClawHub copy.
