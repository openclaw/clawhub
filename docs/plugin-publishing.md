---
summary: "Publisher workflow for code-plugin and bundle-plugin ClawPack releases."
read_when:
  - Publishing plugin packages
  - Updating the publish UI
  - Debugging package publish validation
---

# Plugin Publishing

ClawHub supports plugin package publishing for `code-plugin` and
`bundle-plugin` families. Publishing creates a package release and, when source
validation passes, a stored ClawPack artifact.

This is ClawHub-only. It does not remove bundled plugins from OpenClaw and does
not mean OpenClaw can install the artifact yet.

## Web Flow

Use:

```text
/publish-plugin
```

The publish page accepts:

- `.zip`
- `.tgz`
- `.tar.gz`
- folder upload

The page expands package source in the browser, normalizes paths, ignores local
junk, extracts package metadata, and previews the ClawPack manifest ClawHub
will generate.

Publisher checks should make these facts obvious before publish:

- package name
- display name
- version
- package family
- source repository and path where known
- source ref or commit where known
- OpenClaw compatibility range
- plugin API compatibility range
- host target matrix
- environment requirements
- files that will be included
- ignored files
- blocking errors
- non-blocking warnings

The metadata form stays locked until package source is selected because source
inspection is the trust boundary. The upload panel is the primary next action.

## CLI Flow

Preview first:

```bash
clawhub package publish ./my-plugin --family code-plugin --dry-run
```

Publish:

```bash
clawhub package publish ./my-plugin --family code-plugin
```

Supported source locators:

- local folder
- local archive
- `owner/repo`
- `owner/repo@ref`
- GitHub URL

Private GitHub imports require `GITHUB_TOKEN` in the publisher environment.

## Code Plugin Minimum Metadata

Code plugins must declare OpenClaw compatibility explicitly. Do not rely on the
package version as a fallback for runtime compatibility.

```json
{
  "name": "@example/openclaw-plugin",
  "version": "1.0.0",
  "type": "module",
  "openclaw": {
    "extensions": ["./dist/index.js"],
    "compat": {
      "pluginApi": ">=2026.3.24-beta.2"
    },
    "build": {
      "openclawVersion": "2026.3.24-beta.2"
    }
  }
}
```

Required:

- `openclaw.extensions`
- `openclaw.compat.pluginApi`
- `openclaw.build.openclawVersion`

Optional but useful:

- `openclaw.compat.minGatewayVersion`
- `openclaw.build.pluginSdkVersion`
- host target declarations
- environment requirement declarations

## Bundle Plugin Metadata

Bundle plugins should ship a bundle manifest such as `openclaw.bundle.json`.
They do not execute native code, but they still need source attribution,
versioning, family labels, and moderation.

The UI and API must never blur bundle plugins with code plugins. Cards, detail
pages, and CLI output should explicitly label the family.

## Publish Result

After publish, ClawHub should expose:

- package URL
- release URL
- ClawPack digest when available
- moderation state
- scan state
- next action for the publisher

New releases may remain pending or limited until scans and moderation complete.
Published is not the same thing as publicly installable.

## Common Blockers

- missing `package.json`
- missing plugin or bundle manifest
- unsafe archive path
- missing code-plugin compatibility fields
- invalid version
- unsupported package family
- unknown source attribution
- empty ClawPack file list
- storage failure after validation

Errors should include file or field context. Vague "invalid package" messages
are not acceptable for plugin publishing.
