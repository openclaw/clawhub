---
summary: "Skill folder format, required files, allowed file types, limits."
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

- any supporting _text-based_ files (see “Allowed files”)
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

| Field              | Type       | Description                                                     |
| ------------------ | ---------- | --------------------------------------------------------------- |
| `requires.env`     | `string[]` | Environment variables your skill expects.                       |
| `requires.bins`    | `string[]` | CLI binaries that must all be installed.                        |
| `requires.anyBins` | `string[]` | CLI binaries where at least one must exist.                     |
| `requires.config`  | `string[]` | Config file paths your skill reads.                             |
| `primaryEnv`       | `string`   | The main credential env var for your skill.                     |
| `always`           | `boolean`  | If `true`, skill is always active (no explicit install needed). |
| `skillKey`         | `string`   | Override the skill's invocation key.                            |
| `emoji`            | `string`   | Display emoji for the skill.                                    |
| `homepage`         | `string`   | URL to the skill's homepage or docs.                            |
| `os`               | `string[]` | OS restrictions (e.g. `["macos"]`, `["linux"]`).                |
| `install`          | `array`    | Install specs for dependencies (see below).                     |
| `nix`              | `object`   | Nix plugin spec (see README).                                   |
| `category`         | `string`   | Skill category for moderation context (see below).              |
| `config`           | `object`   | Clawdbot config spec (see README).                              |

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

### Skill categories

Declare your skill's category to give ClawHub's security analysis context about its purpose. This is especially important for security tools, which legitimately contain patterns that would be suspicious in other skill types.

```yaml
metadata:
  openclaw:
    category: security
```

Recognised categories:

| Category   | Description                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `security` | Security scanners, audit tools, threat detectors, IOC databases, and other defensive tools.       |

When `category: security` is declared:

- The static scanner contextualises expected patterns (shell execution for auditing, encoded payloads in IOC databases, credential scanning) so they don't trigger false-positive suspicion.
- The LLM evaluator assesses coherence through a security-tool lens -- does the skill detect threats or deploy them?
- Truly malicious behaviours (crypto mining, obfuscated install payloads, known blocked signatures) are **never** suppressed regardless of category.

Declaring a category that doesn't match your skill's actual purpose is counterproductive -- the LLM evaluator will flag the mismatch as evidence of misdirection.

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

## License

- All skills published on ClawHub are licensed under `MIT-0`.
- Anyone may use, modify, and redistribute published skills, including commercially.
- Attribution is not required.
- Do not add conflicting license terms in `SKILL.md`; ClawHub does not support per-skill license overrides.
