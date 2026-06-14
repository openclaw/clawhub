---
summary: "Canonical OpenClaw plugin development docs and ClawHub publishing links."
read_when:
  - Building or testing an OpenClaw plugin
  - Preparing an OpenClaw plugin for ClawHub publishing
  - Looking for the current OpenClaw Plugin SDK reference
title: "Plugin development"
---

# Plugin development

OpenClaw owns the plugin runtime and SDK, so its documentation is the canonical
source for plugin authoring guidance. ClawHub documents registry-specific
validation and publishing instead of copying the OpenClaw reference.

## Start with OpenClaw

- [Plugin system and installation](https://docs.openclaw.ai/tools/plugin)
- [Building plugins](https://docs.openclaw.ai/plugins/building-plugins)
- [Plugin SDK overview](https://docs.openclaw.ai/plugins/sdk-overview)
- [Plugin manifest](https://docs.openclaw.ai/plugins/manifest)
- [Plugin SDK testing](https://docs.openclaw.ai/plugins/sdk-testing)

Choose the guide for the capability your plugin adds:

- [Tool plugins](https://docs.openclaw.ai/plugins/tool-plugins)
- [Channel plugins](https://docs.openclaw.ai/plugins/sdk-channel-plugins)
- [Provider plugins](https://docs.openclaw.ai/plugins/sdk-provider-plugins)
- [CLI backend plugins](https://docs.openclaw.ai/plugins/cli-backend-plugins)

For the current inspection implementation, see
[openclaw/plugin-inspector](https://github.com/openclaw/plugin-inspector).

## Publish through ClawHub

After building and testing against OpenClaw:

1. Run `clawhub package validate <path-to-plugin>`.
2. Fix any [ClawHub validation findings](./plugin-validation-fixes.md).
3. Run `clawhub package publish <source> --dry-run`.
4. Publish with `clawhub package publish <source>`.

See [ClawHub publishing](./publishing.md) and the
[ClawHub CLI reference](./cli.md) for registry-specific behavior.

## Skills

OpenClaw also owns the canonical [skills documentation](https://docs.openclaw.ai/tools/skills)
and [skill authoring guide](https://docs.openclaw.ai/tools/creating-skills).
