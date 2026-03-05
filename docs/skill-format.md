---
summary: 'Skill folder format, required files, allowed file types, limits.'
read_when:
  - Publishing skills
  - Debugging publish/sync failures
---

# Skill format

## On disk

A skill is a folder.

Required:

- `SKILL.md` (or `skill.md`)

Optional:

- any supporting *text-based* files (see “Allowed files”)
- `.clawhubignore` (ignore patterns for publish/sync, legacy `.clawdhubignore`)
- `.gitignore` (also honored)

Local install metadata (written by the CLI):

- `<skill>/.clawhub/origin.json` (legacy `.clawdhub`)

Workdir install state (written by the CLI):

- `<workdir>/.clawhub/lock.json` (legacy `.clawdhub`)

## `SKILL.md`

- Markdown with optional YAML frontmatter.
- The server extracts metadata from frontmatter during publish.
- `description` is used as the skill summary in the UI/search.

## Frontmatter metadata

Skill metadata is declared in the YAML frontmatter at the top of your `SKILL.md`. This tells the registry (and security analysis) what your skill needs to run.

### Basic frontmatter

```yaml
---
name: my-skill
description: Short summary of what this skill does.
version: 1.0.0
---
```

### Runtime metadata (`metadata.openclaw`)

Declare your skill's runtime requirements under `metadata.openclaw` (aliases: `metadata.clawdbot`, `metadata.clawdis`).

```yaml
---
name: my-skill
description: Manage tasks via the Todoist API.
metadata:
  openclaw:
    requires:
      env:
        - TODOIST_API_KEY
      bins:
        - curl
    primaryEnv: TODOIST_API_KEY
---
```

### Full field reference

| Field | Type | Description |
|-------|------|-------------|
| `requires.env` | `string[]` | Environment variables your skill expects. |
| `requires.bins` | `string[]` | CLI binaries that must all be installed. |
| `requires.anyBins` | `string[]` | CLI binaries where at least one must exist. |
| `requires.config` | `string[]` | Config file paths your skill reads. |
| `primaryEnv` | `string` | The main credential env var for your skill. |
| `always` | `boolean` | If `true`, skill is always active (no explicit install needed). |
| `skillKey` | `string` | Override the skill's invocation key. |
| `emoji` | `string` | Display emoji for the skill. |
| `homepage` | `string` | URL to the skill's homepage or docs. |
| `os` | `string[]` | OS restrictions (e.g. `["macos"]`, `["linux"]`). |
| `install` | `array` | Install specs for dependencies (see below). |
| `nix` | `object` | Nix plugin spec (see README). |
| `config` | `object` | Clawdbot config spec (see README). |

### License

Declare the license for your skill using the optional `license` frontmatter field. Use an [SPDX identifier](https://spdx.org/licenses/) when possible.

#### Simple (SPDX string)

```yaml
---
name: my-skill
license: MIT
---
```

#### Structured (PIL-aligned terms)

Field names align with [Story Protocol's Programmable IP License (PIL)](https://docs.story.foundation/) for future on-chain compatibility.

```yaml
---
name: my-skill
license:
  spdx: Apache-2.0
  transferable: true
  commercialUse: true
  commercialAttribution: true
  derivativesAllowed: true
  derivativesAttribution: true
  derivativesApproval: false
  derivativesReciprocal: false
  uri: https://example.com/LICENSE
---
```

| Field | Type | PIL field | Description |
|-------|------|-----------|-------------|
| `spdx` | `string` | — | SPDX license identifier (required if using object form, max 64 chars). |
| `transferable` | `boolean` | `transferable` | Whether the license can be transferred to another party. |
| `commercialUse` | `boolean` | `commercialUse` | Whether commercial use is permitted. |
| `commercialAttribution` | `boolean` | `commercialAttribution` | Whether attribution is required for commercial use. |
| `derivativesAllowed` | `boolean` | `derivativesAllowed` | Whether derivative works are permitted. |
| `derivativesAttribution` | `boolean` | `derivativesAttribution` | Whether attribution is required for derivative works. |
| `derivativesApproval` | `boolean` | `derivativesApproval` | Whether derivative works need explicit approval from the licensor. |
| `derivativesReciprocal` | `boolean` | `derivativesReciprocal` | Whether derivative works must use the same license (copyleft). |
| `uri` | `string` | `uri` | URL to the full license text (must be `https://`, max 2048 chars). |

**Deprecated fields** (still accepted in frontmatter, normalized automatically):

| Old field | Normalized to |
|-----------|---------------|
| `commercial` | `commercialUse` |
| `attribution: 'required'` | `commercialAttribution: true` + `derivativesAttribution: true` |
| `attribution: 'none'` | `commercialAttribution: false` + `derivativesAttribution: false` |
| `derivatives: 'allowed'` | `derivativesAllowed: true` + `derivativesReciprocal: false` |
| `derivatives: 'allowed-same-license'` | `derivativesAllowed: true` + `derivativesReciprocal: true` |
| `derivatives: 'not-allowed'` | `derivativesAllowed: false` |
| `url` | `uri` |

**Recognized SPDX identifiers:** MIT, Apache-2.0, GPL-2.0-only, GPL-3.0-only, LGPL-2.1-only, LGPL-3.0-only, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, AGPL-3.0-only, Unlicense, CC-BY-4.0, CC-BY-SA-4.0, CC-BY-NC-4.0, CC-BY-NC-SA-4.0, CC0-1.0, proprietary.

Custom identifiers are accepted. When no license is declared, the skill page displays "No license declared."

### Install specs

If your skill needs dependencies installed, declare them in the `install` array:

```yaml
metadata:
  openclaw:
    install:
      - kind: brew
        formula: jq
        bins: [jq]
      - kind: node
        package: typescript
        bins: [tsc]
```

Supported install kinds: `brew`, `node`, `go`, `uv`.

### Why this matters

ClawHub's security analysis checks that what your skill declares matches what it actually does. If your code references `TODOIST_API_KEY` but your frontmatter doesn't declare it under `requires.env`, the analysis will flag a metadata mismatch. Keeping declarations accurate helps your skill pass review and helps users understand what they're installing.

### Example: complete frontmatter

```yaml
---
name: todoist-cli
description: Manage Todoist tasks, projects, and labels from the command line.
version: 1.2.0
metadata:
  openclaw:
    requires:
      env:
        - TODOIST_API_KEY
      bins:
        - curl
    primaryEnv: TODOIST_API_KEY
    emoji: "\u2705"
    homepage: https://github.com/example/todoist-cli
---
```

## Allowed files

Only “text-based” files are accepted by publish.

- Extension allowlist is in `packages/schema/src/textFiles.ts` (`TEXT_FILE_EXTENSIONS`).
- Content types starting with `text/` are treated as text; plus a small allowlist (JSON/YAML/TOML/JS/TS/Markdown/SVG).

Limits (server-side):

- Total bundle size: 50MB.
- Embedding text includes `SKILL.md` + up to ~40 non-`.md` files (best-effort cap).

## Slugs

- Derived from folder name by default.
- Must be lowercase and URL-safe: `^[a-z0-9][a-z0-9-]*$`.

## Versioning + tags

- Each publish creates a new version (semver).
- Tags are string pointers to a version; `latest` is commonly used.
