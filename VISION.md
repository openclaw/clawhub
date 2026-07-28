# ClawHub Vision

ClawHub is the app store for OpenClaw agents.

Under that experience, ClawHub is the public registry and trust layer for
OpenClaw extensions. People should be able to confidently discover what to
install, while publishers release durable, versioned work under identities they
control.

ClawHub should help someone start with a useful agent, understand what it
contains, and make it their own. Clear provenance, adoption, and security
evidence should help users judge what to install.

ClawHub began as a public registry for skills and plugins. That registry remains
important infrastructure, but it is not the final product. The direction is to
move up one level: from helping people assemble individual components to helping
them discover and install complete starting points for personal agents.

Project overview and developer docs: [`README.md`](README.md)

## Claws

A Claw is an installable personal-agent template. It combines skills, plugins,
and agent configuration into a useful starting point that OpenClaw can install
and run.

Claws should make the first experience simple without making the result opaque.
A user should be able to:

- discover a Claw for a real use case
- inspect its publisher, components, permissions, and security evidence
- install it with one clear action
- customize it as their needs and confidence grow

The goal is not to hide OpenClaw forever. It is to let people begin with
something useful before they need to understand every skill, plugin, agent file,
or configuration convention.

Claws are ClawHub's primary product object. Skills and plugins remain important
building blocks, and ClawHub should continue helping users and publishers find,
release, inspect, and maintain them.

## Discovery And Ecosystem Signals

ClawHub should surface the best available OpenClaw building blocks whether they
originated on ClawHub or elsewhere in the ecosystem.

Aggregated content must keep its identity and provenance. Users should be able
to tell who published something, where its source and artifacts live, which
version they are inspecting, and which signals came from ClawHub or another
source.

Recommendations should combine two distinct kinds of evidence:

- ecosystem signals, such as broad adoption and popularity
- OpenClaw-specific signals, such as installs and usefulness within OpenClaw

These signals should complement each other without being conflated. Popularity
is not the same as trust, and OpenClaw-specific usage should not be presented as
ecosystem-wide adoption.

## Identity And Authorization

ClawHub is the ecosystem identity and authorization layer for OpenClaw
distribution.

It represents people and organizations as publishers, owns their public
namespaces, and determines who may publish, manage, or distribute content under
those identities. Accounts authenticate individual actors; publishers are the
public ownership boundary for Claws, skills, and plugins.

ClawHub should provide the permissions and tokens needed for registry,
publishing, management, and distribution workflows across OpenClaw ecosystem
services.

This boundary does not include model-provider credentials, channel credentials,
or local runtime secrets. Those belong to OpenClaw and the operator's
environment.

## Trust And Security

ClawHub is open to publishing, but openness does not mean abandoning security
judgment.

ClawHub should continue running its own security scans and applying its own
upload gates, moderation controls, and abuse protections. It may incorporate
external findings and trust signals, but they complement rather than replace
ClawHub's responsibility for the experience it presents.

Users should see provenance, scan results, moderation state, and verification
signals in context. An Official publisher signal verifies a specific publisher
identity; it is not inherited by related accounts and is not a blanket
endorsement of everything that publisher releases.

No scanner, badge, or review can guarantee that an extension is safe. ClawHub
should make risk easier to inspect and act on without implying certainty that
the evidence cannot support.

## Product Boundary

ClawHub owns:

- Claws and their distribution records
- ecosystem identity, publishers, permissions, and publishing authorization
- discovery, provenance, version metadata, and install resolution
- OpenClaw-specific telemetry and recommendation signals
- security scanning, moderation evidence, and trust presentation

OpenClaw owns runtime and installation execution. Source code and artifacts may
live in external repositories or package systems, provided ClawHub can preserve
their identity, version, provenance, and integrity.

ClawHub should be an open experience layer, not a walled garden. Its public
interfaces should make it possible for OpenClaw and other ecosystem tools to
inspect and consume the same registry records and evidence.

## Current Direction

The current focus is:

- make Claws a reliable one-command starting point for useful personal agents
- make strong ecosystem skills and plugins discoverable without requiring them
  to originate on ClawHub
- preserve provenance while combining ecosystem and OpenClaw-specific signals
- strengthen publisher identity, permissions, and authorization
- keep security evidence visible while improving ClawHub-owned scanning and
  moderation

## What ClawHub Will Not Become

- An agent runtime or replacement for OpenClaw.
- A source-control host that requires every project to move its code.
- A universal package registry for every agent framework.
- A store for model-provider keys, channel credentials, or local runtime
  secrets.
- A guarantee that published or scanned content is safe.
- A system that treats popularity, Official status, or any single scanner as
  sufficient proof of trust.

These boundaries are direction-setting guardrails, not a refusal to evolve.
Strong user needs and clear technical evidence can change how ClawHub fulfills
the mission without changing what it is responsible for.
