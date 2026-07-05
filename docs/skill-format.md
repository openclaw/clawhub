---
summary: "Skill folder format, required files, allowed file types, limits."
read_when:
  - Publishing skills
  - Debugging publish failures
---

# Skill format

## On disk

A skill is a folder.

Required:

- `SKILL.md` (or `skill.md`; legacy `skills.md` is also accepted)

Optional:

- any supporting _text-based_ files (see “Allowed files”)
- `.clawhubignore` (ignore patterns for publishing, legacy `.clawdhubignore`)
- `.gitignore` (also honored)

## GitHub import

The web GitHub importer is stricter than local publish/sync. It only discovers
`SKILL.md` or legacy `skills.md` files in public, non-fork repositories owned by
the signed-in GitHub account. It does not import private repos, forks,
archived/disabled repos, or third-party public repos.

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

Use `requires.env` for environment variables that must be present before the skill can run. Use `envVars` when you need per-variable metadata, including optional variables with `required: false`.

### Full field reference

| Field              | Type       | Description                                                                                                                                  |
| ------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `requires.env`     | `string[]` | Required environment variables your skill expects.                                                                                           |
| `requires.bins`    | `string[]` | CLI binaries that must all be installed.                                                                                                     |
| `requires.anyBins` | `string[]` | CLI binaries where at least one must exist.                                                                                                  |
| `requires.config`  | `string[]` | Config file paths your skill reads.                                                                                                          |
| `primaryEnv`       | `string`   | The main credential env var for your skill.                                                                                                  |
| `envVars`          | `array`    | Environment variable declarations with `name`, optional `required`, and optional `description`. Set `required: false` for optional env vars. |
| `always`           | `boolean`  | If `true`, skill is always active (no explicit install needed).                                                                              |
| `skillKey`         | `string`   | Override the skill's invocation key.                                                                                                         |
| `emoji`            | `string`   | Display emoji for the skill.                                                                                                                 |
| `homepage`         | `string`   | URL to the skill's homepage or docs.                                                                                                         |
| `os`               | `string[]` | OS restrictions (e.g. `["macos"]`, `["linux"]`).                                                                                             |
| `install`          | `array`    | Install specs for dependencies (see below).                                                                                                  |
| `nix`              | `object`   | Nix plugin spec (see README).                                                                                                                |
| `config`           | `object`   | Clawdbot config spec (see README).                                                                                                           |

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

### Optional environment variables

Declare optional environment variables under `metadata.openclaw.envVars` and set `required: false`. Do not add optional entries to `requires.env`, because `requires.env` means the skill cannot run without them.

```yaml
metadata:
  openclaw:
    primaryEnv: TODOIST_API_KEY
    envVars:
      - name: TODOIST_API_KEY
        required: true
        description: Todoist API token used for authenticated requests.
      - name: TODOIST_PROJECT_ID
        required: false
        description: Optional default project ID when the user does not specify one.
```

### Why this matters

ClawHub's security analysis checks that what your skill declares matches what it actually does. If your code references `TODOIST_API_KEY` but your frontmatter doesn't declare it under `requires.env`, `primaryEnv`, or `envVars`, the analysis will flag a metadata mismatch. Keeping declarations accurate helps your skill pass review and helps users understand what they're installing.

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
    envVars:
      - name: TODOIST_API_KEY
        required: true
        description: Todoist API token.
      - name: TODOIST_PROJECT_ID
        required: false
        description: Optional default project ID.
    emoji: "\u2705"
    homepage: https://github.com/example/todoist-cli
---
```

## Allowed files

Only “text-based” files are accepted by publish.

- Extension allowlist is in `packages/schema/src/textFiles.ts` (`TEXT_FILE_EXTENSIONS`).
- Script files are still scanned after upload; PowerShell `.ps1`, `.psm1`, and `.psd1` files are accepted as text.
- Content types starting with `text/` are treated as text; plus a small allowlist (JSON/YAML/TOML/JS/TS/Markdown/SVG).

Limits (server-side):

- Total bundle size: 50MB.
- Embedding text includes `SKILL.md` + up to ~40 non-`.md` files (best-effort cap).

## Slugs

- Derived from folder name by default.
- Package scopes must match the ClawHub publisher handle exactly. Publisher handles can use lowercase letters, numbers, hyphens, dots, and underscores; they must start and end with a lowercase letter or number.
- Package slugs must be lowercase and npm-safe, for example `@example.tools/demo-plugin` or `demo-plugin`.

## Versioning + tags

- Each publish creates a new version (semver).
- Tags are string pointers to a version; `latest` is commonly used.

## License

- ClawHub records `MIT` when a skill package declares standard MIT in a root `package.json` or standard MIT `LICENSE` file.
- If no supported license is declared, ClawHub records the default skill license, `MIT-0`.
- Anyone may use, modify, and redistribute published skills according to the license shown for that version.
- Do not add conflicting license terms in `SKILL.md`; use `package.json` or `LICENSE` for supported license metadata.

## Paid skills

- ClawHub does not support paid skills, per-skill pricing, paywalls, or revenue sharing.
- Do not add pricing metadata to `SKILL.md`; it is not part of the skill format and will not make a published skill paid.
- If your skill integrates with a paid third-party service, document the external cost and required account clearly in the skill instructions and env declarations (`requires.env` for required variables, or `envVars` with `required: false` for optional variables).
