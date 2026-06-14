---
summary: "Create, test, and publish OpenClaw skills on ClawHub."
read_when:
  - Creating a new SKILL.md skill
  - Preparing a skill for ClawHub publishing
  - Shipping skills inside an OpenClaw plugin
title: "Creating skills"
---

# Creating skills

Skills are compact instruction bundles that teach an agent how and when to use
tools. A skill is a directory centered on `SKILL.md`, with optional scripts,
references, examples, templates, and assets.

This guide covers the authoring and publishing path. See
[Skill format](./skill-format.md) for the full ClawHub metadata, file, size,
license, and version rules.

## Create a skill

Create a directory with a `SKILL.md` file:

```text
hello-world/
  SKILL.md
```

Start with clear frontmatter and short, concrete instructions:

````markdown
---
name: hello-world
description: Print a greeting when the user asks for one.
---

# Hello World

When the user asks for a greeting, run:

```bash
echo "Hello from your custom skill!"
```
````

Keep the `name` lowercase and hyphenated. Make the `description` specific
enough that an agent can decide when to load the skill.

## Organize supporting files

Keep `SKILL.md` focused on the workflow. Put detailed material beside it:

```text
my-skill/
  SKILL.md
  scripts/       deterministic helpers
  references/    detailed task reference
  examples/      example input and output
  assets/        templates and output resources
```

Use `{baseDir}` in `SKILL.md` when instructions need to reference a file inside
the installed skill:

```markdown
Run `{baseDir}/scripts/report.sh`.
```

ClawHub accepts text-based supporting files. Review the allowlist and limits in
[Skill format](./skill-format.md#allowed-files) before publishing.

## Declare runtime requirements

Declare the environment variables, binaries, configuration, operating systems,
and installers the skill needs under `metadata.openclaw`.

```yaml
---
name: todoist
description: Manage Todoist tasks and projects.
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
        description: Optional default project.
---
```

Accurate declarations help users understand the install and help ClawHub's
security analysis distinguish expected behavior from undeclared access.

## Write effective instructions

- State when the skill should run and when it should not.
- Keep steps ordered and concrete.
- Put brittle command syntax, required checks, and safety constraints in the
  skill.
- Move long explanations and examples into supporting files.
- Prefer deterministic scripts for repeated transformations.
- Do not hide network access, secret use, install commands, or external costs.

## Test in OpenClaw

Place the skill in an OpenClaw skill root, then verify that OpenClaw discovers
it:

```bash
openclaw skills list
openclaw agent --message "use my new skill"
```

Test both the intended trigger and a nearby request that should not trigger the
skill. Verify required binaries, environment variables, supporting files, and
failure messages on a clean setup.

OpenClaw owns skill loading, precedence, gating, allowlists, and runtime
configuration. See the
[OpenClaw skills documentation](https://docs.openclaw.ai/tools/skills) for
those runtime details.

## Ship a skill inside a plugin

An OpenClaw plugin can ship related skills by listing skill roots in
`openclaw.plugin.json`:

```json
{
  "id": "acme-tools",
  "skills": ["./skills"]
}
```

Each skill under that root still needs its own `SKILL.md`:

```text
acme-tools/
  openclaw.plugin.json
  skills/
    acme-reports/
      SKILL.md
```

Plugin skills load only while the plugin is enabled. Gate a plugin-owned skill
with `metadata.openclaw.requires.config` when it depends on configured plugin
state. OpenClaw loads plugin skills at low precedence so users can override them
with managed or workspace skills.

Publish the complete plugin package with `clawhub package publish`; do not
publish its embedded skill directories as unrelated standalone skills unless
they are also designed to work independently.

## Publish to ClawHub

Sign in and publish the skill directory:

```bash
clawhub login
clawhub skill publish ./my-skill \
  --slug my-skill \
  --name "My Skill" \
  --version 1.0.0
```

For a catalog repository, preview and publish changed skills with `sync`:

```bash
clawhub sync --dry-run
clawhub sync --all
```

Before publishing:

- verify the skill in OpenClaw
- check the frontmatter and runtime requirement declarations
- remove secrets, generated output, and unrelated files
- review install commands and remote execution
- use a new semantic version
- describe the change in the release changelog

Published skills are subject to ClawHub's upload gates, automated security
checks, and moderation policy. See [Publishing](./publishing.md),
[Security audits](./security-audits.md), and
[Acceptable usage](./acceptable-usage.md).
