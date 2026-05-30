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

## Official

Official is a ClawHub policy flag derived from the hard-coded `openclaw`
organization. The `openclaw` org publisher is Official, and personal publishers
for `openclaw` org members are Official while that membership exists.

Official does not come from uploaded skill or package metadata, and org
membership outside the `openclaw` org does not make a personal publisher
Official.

The same policy shows as an `Official` badge on publisher/profile UI. New
public packages from an Official publisher use the `official` channel; private
packages stay private.

`trustedPublisher` is an internal automated-publish permission. It does not make
a publisher or package Official.

## Skills

Skills are published from a skill folder. The public page is:

```text
https://clawhub.ai/<owner>/<slug>
```

Example:

```text
https://clawhub.ai/alice/review-helper
```

The publish request includes the selected owner, slug, version, changelog, and
files. The server verifies that the actor can publish as that owner before it
creates the release.

To move an existing skill to another owner while publishing a new version, choose
the new owner and explicitly confirm the ownership move. In the CLI/API, pass the
target owner plus the migration opt-in:

```sh
clawhub skill publish ./review-helper --owner openclaw --migrate-owner --version 1.2.0
```

Skill owner migration requires admin or owner access on both the current owner
and the destination owner. It preserves the skill, version history, stats,
comments, forks, aliases, and audit trail; old owner URLs continue through the
alias/redirect path.

### GitHub Actions for Skills

Use the reusable skill workflow for catalog repos that keep many skills under a
directory such as `skills/`. Pull requests should run dry-run previews, and real
publishes should start with manual `workflow_dispatch` runs.

```yaml
jobs:
  publish:
    uses: openclaw/clawhub/.github/workflows/skill-publish.yml@v1
    with:
      owner: nvidia
      dry_run: false
    secrets:
      clawhub_token: ${{ secrets.CLAWHUB_TOKEN }}
```

`root` defaults to `skills`. To publish or preview one folder, pass
`skill_path`, for example `skill_path: skills/review-helper`.

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
