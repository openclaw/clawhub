---
summary: "How ClawHub publishing works for skills, plugins, owners, scopes, releases, and review."
read_when:
  - Publishing a skill or plugin
  - Debugging owner or package scope errors
  - Adding publish UI, CLI, or backend behavior
---

# Publishing

ClawHub publishing is owner-scoped: every publish targets a publisher, and the
server decides whether the signed-in user is allowed to publish there.

## Owners

An owner is a ClawHub publisher handle, such as `@alice` or `@openclaw`.
Personal owners are created for users. Org owners can have multiple members.

When you publish, you either use your personal owner or choose an org owner
where you have publisher access.

## Skills

For a catalog repo, keep skills in folders under `skills/`:

```text
skills/
  review-helper/
    SKILL.md
  rag-blueprint/
    SKILL.md
```

The simplest publishing path is the CLI. Sign in, preview the sync plan, then
publish the new or changed skills:

```bash
clawhub login
clawhub sync --dry-run --owner nvidia --no-clawdbot-roots
clawhub sync --all --owner nvidia --no-clawdbot-roots
```

`sync` scans for folders containing `SKILL.md`, compares them with ClawHub, and
publishes anything new or changed. Use `--dry-run` first to see the plan without
uploading. Use `--owner <handle>` when publishing to an org owner; omit it to
publish as the authenticated user. `--no-clawdbot-roots` keeps the scan limited
to the current repo and explicit roots, which is usually what CI and catalog
repos want.

The public page for a published skill is:

```text
https://clawhub.ai/<owner>/<slug>
```

### GitHub Actions for Skills

If you want to run skill publishing from CI, call ClawHub's reusable skill
workflow from a small workflow in your repo. The example below is shaped for a
catalog repo: operators choose whether to preview the full catalog, publish one
skill folder, or publish the whole catalog.

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
        description: Skill folder for publish-single, for example skills/review-helper.
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
              echo "::error::skill_path must point under skills/, for example skills/review-helper."
              exit 1
              ;;
          esac

  dry-run:
    if: github.event_name == 'workflow_dispatch' && inputs.mode == 'dry-run'
    uses: openclaw/clawhub/.github/workflows/skill-publish.yml@main
    with:
      owner: nvidia
      dry_run: true
    secrets:
      clawhub_token: ${{ secrets.CLAWHUB_TOKEN }}

  publish-single:
    if: github.event_name == 'workflow_dispatch' && inputs.mode == 'publish-single'
    needs: validate-single
    uses: openclaw/clawhub/.github/workflows/skill-publish.yml@main
    with:
      owner: nvidia
      skill_path: ${{ inputs.skill_path }}
      dry_run: false
    secrets:
      clawhub_token: ${{ secrets.CLAWHUB_TOKEN }}

  publish-catalog:
    if: github.event_name == 'workflow_dispatch' && inputs.mode == 'publish-catalog'
    uses: openclaw/clawhub/.github/workflows/skill-publish.yml@main
    with:
      owner: nvidia
      dry_run: false
    secrets:
      clawhub_token: ${{ secrets.CLAWHUB_TOKEN }}
```

Replace `nvidia` with your ClawHub owner handle. The called workflow defaults to
scanning `skills/`; pass `skill_path` only when you want to process one folder.

Before running a real publish, add a `CLAWHUB_TOKEN` repository secret. The token
must belong to a ClawHub user that can publish to the selected owner.

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
- Run `clawhub package publish <source> --dry-run` before creating a release.
- Expect new releases to stay out of public install surfaces until automated
  security checks and verification finish.

## Release Flow

1. The UI, CLI, or GitHub workflow gathers package metadata and files.
2. The publish request is sent to ClawHub with the selected owner.
3. The server validates owner permissions, package scope, package name, version,
   file limits, and source metadata.
4. ClawHub stores the release and starts automated security checks.
5. New releases are hidden from normal install/download surfaces until review
   and verification finish.

If validation fails, the release is not created.

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
