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
  --owner <owner>
```

Use `--owner <handle>` when publishing to an org owner. Omit it to publish as
the authenticated user. Publishing skips unchanged content. A new skill starts
at `1.0.0`, and later changes automatically publish the next patch version. Pass
`--version` only when you need an explicit version.

For catalog repos, use ClawHub's reusable
[`skill-publish.yml` workflow](https://github.com/openclaw/clawhub/blob/main/.github/workflows/skill-publish.yml).
It calls `skill publish` for each immediate skill folder under `root` (default:
`skills`), or only the folder supplied as `skill_path`.

```yaml
jobs:
  publish:
    uses: openclaw/clawhub/.github/workflows/skill-publish.yml@main
    with:
      owner: <owner>
      dry_run: false
    secrets:
      clawhub_token: ${{ secrets.CLAWHUB_TOKEN }}
```

Use `dry_run: true` to preview new and changed skills without publishing.

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

If you are the rightful owner of an org, brand, package scope, owner handle, or
namespace that is already claimed or reserved on ClawHub, open an
[Org / Namespace Claim issue](https://github.com/openclaw/clawhub/issues/new?template=org-namespace-claim.yml)
with public, non-sensitive proof. See
[Org and Namespace Claims](./namespace-claims.md) for what to include and what
to keep out of public issues.

### Before Publishing a Plugin

- Pick an owner that matches the package scope.
- Include `openclaw.plugin.json`. Code plugins also need `package.json` with
  `openclaw.compat.pluginApi` and `openclaw.build.openclawVersion`.
- To show a custom plugin card icon, add `icon` to `openclaw.plugin.json` with
  any HTTPS image URL.
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

ClawHub verifies the configured GitHub repository when trusted publisher config
is set. Public repositories can be verified through public GitHub metadata.
Private repositories require ClawHub to have GitHub access to that repository,
for example through a future ClawHub GitHub App installation or another
authorized GitHub integration.

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

If you do not have access to the current owner but believe your org, project, or
brand is the rightful namespace owner, open an
[Org / Namespace Claim issue](https://github.com/openclaw/clawhub/issues/new?template=org-namespace-claim.yml)
with public, non-sensitive proof for staff review. See
[Org and Namespace Claims](./namespace-claims.md) before filing.

This protects org namespaces. A package named `@openclaw/dronzer` claims the
`@openclaw` namespace, so only publishers with access to the `@openclaw` owner
can publish it.
