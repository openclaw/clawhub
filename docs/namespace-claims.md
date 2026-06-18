---
summary: "How to request ClawHub review for org, brand, owner-handle, package-scope, skill-slug, or namespace ownership disputes."
read_when:
  - Claiming an org, brand, package scope, owner handle, skill slug, or package namespace
  - Resolving a namespace that is already claimed or reserved
  - Deciding whether to use a report, appeal, or namespace claim
title: "Org and Namespace Claims"
sidebarTitle: "Org and Namespace Claims"
---

# Org and Namespace Claims

ClawHub uses owner handles, org handles, skill slugs, plugin package names, and
package scopes as public namespaces. If a namespace appears to belong to a
real-world project, brand, package ecosystem, or organization but is already
claimed, reserved, misleading, or disputed on ClawHub, ask staff to review it
with the
[Org / Namespace Claim issue form](https://github.com/openclaw/clawhub/issues/new?template=org-namespace-claim.yml).

Use this path for public, non-sensitive ownership review. Do not use in-product
reports or the account appeal form for namespace claims.

## When to Open a Claim

Open a namespace claim when you believe ClawHub staff should review whether a
namespace should be reserved, transferred, renamed, hidden, quarantined, aliased,
or otherwise changed because of real-world ownership.

Examples include:

- an org handle that matches your GitHub org, project, company, or community
- a package scope such as `@example-org/*` that should only publish under the
  matching ClawHub owner
- a skill slug or plugin package name that appears to impersonate a project
- a brand, trademark, project rename, or package history dispute
- a deleted, inactive, or unreachable owner that blocks the rightful namespace
  owner

If the listing is unsafe, malicious, or misleading beyond the ownership dispute,
also follow the relevant moderation or security guidance. The namespace claim
form is for ownership review, not emergency vulnerability disclosure.

## Before You File

First confirm that you are publishing with the owner that matches the namespace.
For plugin packages, scoped names such as `@example-org/example-plugin` must be
published as the matching `example-org` owner.

If you can manage the current owner, fix the namespace directly by publishing,
renaming, transferring, hiding, or deleting the affected resource. Use a claim
when you cannot manage the current owner or when staff needs to resolve a
dispute.

## Evidence to Include

Use public, non-sensitive evidence. Helpful proof includes:

- GitHub org, repo, release, or maintainer history
- official project docs that name the namespace
- domain or official email-domain proof
- npm, PyPI, crates.io, or other package-registry scope control
- trademark, brand, or project ownership evidence that is safe to discuss
  publicly
- source repository history, package history, or public rename notices
- links to the disputed ClawHub owner, skill, plugin, package, or issue

Explain what each link proves. Staff should be able to understand the
relationship without needing private credentials or secrets.

## What Not to Include

Do not put secrets or private proof in a public GitHub issue. Do not include:

- API tokens, signing keys, or credentials
- DNS challenge tokens
- private legal files or contracts
- personal identity documents
- private emails, private security reports, or confidential customer data

The claim form asks whether sensitive evidence needs a private staff channel.
Use that option instead of posting sensitive material publicly.

## Possible Outcomes

Depending on the evidence and risk, ClawHub staff may reserve a namespace,
transfer ownership, rename a resource, hide or quarantine an existing listing,
add an alias or redirect, ask for more proof, or decline the request.

Namespace review does not guarantee that every matching name will be transferred.
Staff weighs public evidence, existing usage, security risk, and user impact.

## Related Docs

- [Publishing](./publishing.md)
- [Troubleshooting](./troubleshooting.md#publish-fails-because-a-namespace-is-claimed-or-reserved)
- [Moderation and Account Safety](./moderation.md)
- [Security](./security.md)
