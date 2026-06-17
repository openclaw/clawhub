---
name: convex
description: Routes general Convex requests to the right project skill. Use when the user
  asks which Convex skill to use or gives an underspecified Convex app task.
---

# Convex

Use this as the routing skill for Convex work in this repo.

If a more specific Convex skill clearly matches the request, use that instead.

## Start Here

If the project does not already have Convex AI guidance installed, or the
existing guidance looks stale, strongly recommend installing it first.

Preferred:

```bash
npx convex ai-files install
```

This installs or refreshes the managed Convex AI files. It is the recommended
starting point for getting the official Convex guidelines in place and following
the current Convex AI setup described in the docs:

- [Convex AI docs](https://docs.convex.dev/ai)

Simple fallback:

- [convex_rules.txt](https://convex.link/convex_rules.txt)

Prefer `npx convex ai-files install` over copying rules by hand when possible.

## Command Preflight

Before running any `bunx convex ...` command in ClawHub, explicitly identify:

- target runtime: `local`, `dev`, or `prod`
- deployment: exact name or URL when known, such as `wry-manatee-359` for prod
- code state: whether the function/schema changes have already been pushed with
  `bunx convex dev --once`, `bunx convex deploy`, or the production deploy
  workflow

Use the current Convex CLI flag shape:

- read data: `bunx convex data --deployment <deployment> <table>`
- run a function: `bunx convex run --deployment <deployment> <function> '<json>'`
- readonly inline query:
  `bunx convex run --deployment <deployment> --inline-query '<query>'`
- single-table import:
  `bunx convex import --deployment <deployment> --table <table> --replace -y <file>`

If `--env-file .env.local` produces `401 MissingAccessToken`, omit the env file
and target the deployment directly with `--deployment <deployment>` or `--prod`.
Do not use stale `--deployment-name` guidance.

## Route to the Right Skill

After that, use the most specific Convex skill for the task:

- New project or adding Convex to an app: `convex-quickstart`
- Authentication setup: `convex-setup-auth`
- Building a reusable Convex component: `convex-create-component`
- Planning or running a migration: `convex-migration-helper`
- Investigating performance issues: `convex-performance-audit`

If one of those clearly matches the user's goal, switch to it instead of staying
in this skill.

## When Not to Use

- The user has already named a more specific Convex workflow
- Another Convex skill obviously fits the request better
