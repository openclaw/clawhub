---
summary: "How ClawHub publishing works for skills, plugins, owners, scopes, releases, and review."
read_when:
  - Publishing a skill or plugin
  - Debugging owner or package scope errors
  - Adding publish UI, CLI, or backend behavior
---

# Publishing

Publishing sends a skill folder or plugin package to ClawHub under the owner you
choose. ClawHub checks that your token can publish for that owner, validates the
metadata, name, version, files, and source information, then stores the release
and starts automated security checks.

If validation fails, nothing is published. New releases may also stay out of
normal install and download surfaces until review finishes.

## Skills

The simplest publishing path is the CLI. Sign in, then publish a local skill
folder:

```bash
clawhub login
clawhub skill publish ./my-skill \
  --slug my-skill \
  --name "My Skill" \
  --version 1.0.0 \
  --owner <owner>
```

Use `--owner <handle>` when publishing to an org owner. Omit it to publish as
the authenticated user.

For catalog repos, use `sync` to scan folders containing `SKILL.md` and publish
new or changed skills:

```bash
clawhub sync --dry-run --owner <owner>
clawhub sync --all --owner <owner>
```

Use `--dry-run` first to see the plan without uploading.

### GitHub Actions for Skills

If you want to run skill publishing from CI, call ClawHub's reusable
[`skill-publish.yml` workflow](https://github.com/openclaw/clawhub/blob/main/.github/workflows/skill-publish.yml)
from a small workflow in your repo.

The example below is shaped for a catalog repo: operators choose whether to
preview the full catalog, publish one skill folder, or publish the whole
catalog.

```yaml
name: Publish Skills to ClawHub

on:
  workflow_dispatch:
    inputs:
      mode:
        description: What to run.
        type: choice
        required: true
        default: dry-run
        options:
          - dry-run
          - publish-single
          - publish-catalog
      skill_path:
        description: Skill folder for publish-single, for example skills/<slug>.
        type: string
        required: false
        default: ""

permissions:
  contents: read
  id-token: write

jobs:
  validate-single:
    if: github.event_name == 'workflow_dispatch' && inputs.mode == 'publish-single'
    runs-on: ubuntu-latest
    steps:
      - name: Validate single-skill input
        env:
          SKILL_PATH: ${{ inputs.skill_path }}
        run: |
          set -euo pipefail
          if [[ -z "${SKILL_PATH}" ]]; then
            echo "::error::skill_path is required when mode is publish-single."
            exit 1
          fi
          case "${SKILL_PATH}" in
            skills/*) ;;
            *)
              echo "::error::skill_path must point under skills/, for example skills/<slug>."
              exit 1
              ;;
          esac

  dry-run:
    if: github.event_name == 'workflow_dispatch' && inputs.mode == 'dry-run'
    uses: openclaw/clawhub/.github/workflows/skill-publish.yml@main
    with:
      owner: <owner>
      dry_run: true
    secrets:
      clawhub_token: ${{ secrets.CLAWHUB_TOKEN }}

  publish-single:
    if: github.event_name == 'workflow_dispatch' && inputs.mode == 'publish-single'
    needs: validate-single
    uses: openclaw/clawhub/.github/workflows/skill-publish.yml@main
    with:
      owner: <owner>
      skill_path: ${{ inputs.skill_path }}
      dry_run: false
    secrets:
      clawhub_token: ${{ secrets.CLAWHUB_TOKEN }}

  publish-catalog:
    if: github.event_name == 'workflow_dispatch' && inputs.mode == 'publish-catalog'
    uses: openclaw/clawhub/.github/workflows/skill-publish.yml@main
    with:
      owner: <owner>
      dry_run: false
    secrets:
      clawhub_token: ${{ secrets.CLAWHUB_TOKEN }}
```

Replace `<owner>` with your ClawHub owner handle. The called workflow defaults to
scanning `skills/`; pass `skill_path` only when you want to process one folder.

Before running a real publish, sign in as a ClawHub user that can publish to the
selected owner, then store the current CLI token as a `CLAWHUB_TOKEN` repository
secret:

```bash
clawhub login --label "Skills GitHub Actions"
gh secret set CLAWHUB_TOKEN \
  --repo OWNER/REPO \
  --body "$(clawhub token)"
```

Start with `dry-run`, then publish one skill with `publish-single`, and only then
use `publish-catalog` for the full catalog.

## Plugins

Plugins use npm-style package names. Scoped package names include the owner in
the first part of the name:

```text
@owner/package-name
```

The scope must match the selected publish owner. If your package is named
`@openclaw/dronzer`, it can only be published as `@openclaw`. If you publish as
`@vintageayu`, rename the package to `@vintageayu/dronzer`.

This prevents a package from claiming an org namespace that the publisher does
not control.

### Before Publishing a Plugin

- Pick an owner that matches the package scope.
- Include `openclaw.plugin.json`. Code plugins also need `package.json` with
  `openclaw.compat.pluginApi` and `openclaw.build.openclawVersion`.
- Include source repository and exact commit metadata, or use the CLI from a
  GitHub-backed checkout so it can detect them.
- Run `clawhub package validate <source>` before publishing. For package,
  manifest, SDK import, or artifact findings, see
  [Plugin validation fixes](./plugin-validation-fixes.md).
- Run `clawhub package publish <source> --dry-run` before creating a release.
- Expect new releases to stay out of public install surfaces until automated
  security checks and verification finish.

### Trusted Publishing for Packages

Package trusted publishing is a two-step setup:

1. Publish the package once through normal manual or token-authenticated
   `clawhub package publish`. This creates the package row and establishes the
   package managers who can change its trusted publisher config.
2. A package manager sets the GitHub Actions trusted publisher config:

```bash
clawhub package trusted-publisher set @owner/package-name \
  --repository owner/repo \
  --workflow-filename package-publish.yml
```

After config is set, future supported GitHub Actions publishes can use
OIDC/trusted publishing without storing a long-lived ClawHub token in the
repository. The configured repository and workflow filename must match the
GitHub Actions OIDC claim. If you also pass `--environment <name>`, the GitHub
Actions environment claim must match that name exactly.

The current reusable package publish workflow supports secretless trusted
publishing for `workflow_dispatch` publishes when `id-token: write` is
available. Tag-push real publishes still need `clawhub_token`, so keep
`CLAWHUB_TOKEN` available for tag releases, first publishes, untrusted packages,
or break-glass publishes.

Inspect or remove the config with:

```bash
clawhub package trusted-publisher get @owner/package-name
clawhub package trusted-publisher delete @owner/package-name
```

Deleting trusted publisher config is the rollback path. It disables future
trusted publish token minting until a package manager sets config again.

## FAQ

### Package scope must match selected owner

If the package scope and selected owner do not match, ClawHub rejects the
publish:

```text
Package scope "@openclaw" must match selected owner "@vintageayu".
Publish as "@openclaw" or rename this package to "@vintageayu/dronzer".
```

To fix it, either choose the owner named by the package scope, or rename the
package so the scope matches the owner you can publish as.

If the package name already has the right scope but the package is owned by the
wrong publisher, transfer ownership instead:

```sh
clawhub package transfer @opik/opik-openclaw --to opik
```

Use package or skill transfer only when you have admin access to both the
current owner and the destination publisher. Package transfer does not let you
publish into a scope you cannot manage.

This protects org namespaces. A package named `@openclaw/dronzer` claims the
`@openclaw` namespace, so only publishers with access to the `@openclaw` owner
can publish it.
