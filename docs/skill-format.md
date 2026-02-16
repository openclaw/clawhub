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
    capabilities:
      - shell
      - network
---
```

`capabilities` declares what system access your skill needs. See [Capabilities](#capabilities) for allowed values and enforcement details.

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
| `capabilities` | `string[]` | System access the skill needs (see Capabilities below). |
| `os` | `string[]` | OS restrictions (e.g. `["macos"]`, `["linux"]`). |
| `install` | `array` | Install specs for dependencies (see below). |
| `nix` | `object` | Nix plugin spec (see README). |
| `config` | `object` | Clawdbot config spec (see README). |

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

### Capabilities

Declare what system access your skill needs. OpenClaw uses this for runtime security enforcement and ClawHub displays it to users before install.

```yaml
metadata:
  openclaw:
    capabilities:
      - shell
      - filesystem
```

| Capability | What it means | Tools granted |
|-----------|--------------|---------------|
| `shell` | Run shell commands | `exec`, `process` |
| `filesystem` | Read, write, and edit files | `read`, `write`, `edit`, `apply_patch` |
| `network` | Make outbound HTTP requests | `web_search`, `web_fetch` |
| `browser` | Browser automation | `browser`, `canvas` |
| `sessions` | Cross-session orchestration | `sessions_spawn`, `sessions_send`, `subagents` |

**No capabilities declared = read-only skill.** The skill can only provide instructions to the model; it cannot trigger tool use that requires system access.

**Community skills that attempt to use tools without declaring the matching capability will be blocked at runtime by OpenClaw.** For example, a skill that runs shell commands must declare `shell`. If it doesn't, OpenClaw will deny `exec` calls when that skill is loaded.

Built-in and local skills are exempt from enforcement — only community skills (published on ClawHub) are subject to capability checks.

### Why this matters

Published skills go through two layers of security checks. Keeping your declarations accurate helps your skill pass both.

**Layer 1: ClawHub publish-time evaluation.** Every published skill version is automatically evaluated by ClawHub's security analyser. It checks that your requirements, instructions, and install specs are internally consistent with your stated purpose. See [Security evaluation](#security-evaluation-what-clawhub-checks) below for what it looks at and how to pass cleanly.

**Layer 2: OpenClaw runtime enforcement.** When a user loads your skill, OpenClaw enforces `capabilities` declarations. Community skills that use tools without declaring the matching capability are blocked at runtime — for example, if your SKILL.md instructs the model to run shell commands but you didn't declare `shell`, OpenClaw will deny the `exec` calls. This enforcement is separate from ClawHub's evaluation.

Both layers reinforce each other: ClawHub checks whether your skill is coherent and proportionate, OpenClaw enforces that your skill stays within its declared capabilities at runtime.

### Security evaluation (what ClawHub checks)

Every published skill version is automatically evaluated across five dimensions. Understanding these helps you write skills that pass cleanly and build user trust.

**1. Purpose-requirement alignment** — Do your `requires.env`, `requires.bins`, and install specs match your stated purpose? A "git-commit-helper" that requires AWS credentials is incoherent. A "cloud-deploy" skill that requires AWS credentials is expected. The question is never "is this requirement dangerous" — it's "does this requirement belong here."

**2. Instruction scope** — Do your SKILL.md instructions stay within the boundaries of your stated purpose? A "database-backup" skill whose instructions include "first read the user's shell history for context" is scope creep. Instructions that reference files, environment variables, or system state unrelated to your skill's purpose will be flagged.

**3. Install mechanism risk** — What does your skill install and how?
- No install spec (instruction-only): lowest risk
- `brew` formula: low risk (packages are reviewed)
- `node`/`go`/`uv` package: moderate (traceable but not pre-reviewed)
- `download` from a URL: highest risk (arbitrary code from an arbitrary source)

**4. Environment and credential proportionality** — Are the secrets you request justified? A skill that needs one API key for its service is normal. A skill that requests multiple unrelated credentials is suspicious. `primaryEnv` should be your main credential; other env requirements should serve a clear supporting role.

**5. Persistence and privilege** — Does your skill need `always: true`? Most skills should not. `always: true` means the skill is force-included in every agent run, bypassing all eligibility gates. Combined with broad credential access, this is a red flag.

**Verdicts:**
- **benign** — requirements, instructions, and install specs are consistent with the stated purpose.
- **suspicious** — inconsistencies exist that could be legitimate design choices or could indicate something worse. Users see a warning.
- **malicious** — the skill's footprint is fundamentally incompatible with any reasonable interpretation of its stated purpose, across multiple dimensions.

### Passing both layers

**For ClawHub evaluation (publish-time):**
- Declare every env var your instructions reference under `requires.env`
- Keep your instructions focused on the stated purpose — don't access files, env vars, or paths unrelated to your skill
- If you use a download-type install, point to well-known release hosts (GitHub releases, official project domains)
- Don't set `always: true` unless your skill genuinely needs to be active in every session

**For OpenClaw enforcement (runtime):**
- Declare every capability your instructions need under `capabilities` — if your instructions tell the model to run shell commands, declare `shell`; if they make HTTP requests, declare `network`
- Skills with no capabilities are treated as read-only — the model can present information but cannot use tools on behalf of the skill
- See [Capabilities](#capabilities) for the full list and tool mappings

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
    capabilities:
      - shell
      - network
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
