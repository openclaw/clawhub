---
summary: "How to understand ClawHub security audit results before installing a skill or plugin."
read_when:
  - Understanding ClawHub security audit results
  - Deciding whether to install a skill or plugin
  - Explaining ClawHub audit status, risk level, or findings
title: "Security Audits"
sidebarTitle: "Security Audits"
---

# Security Audits

ClawHub security audits help you decide whether a skill or plugin is safe enough
to install. They show what a release does, what authority it asks for, and
whether anything deserves extra attention before it can access files, accounts,
credentials, code, or external services.

Audits are strong safety signals, but they are not a guarantee that a release is
risk-free. Always use judgment before granting sensitive access.

See also [Acceptable usage](./acceptable-usage.md) and
[Moderation and Account Safety](./moderation.md).

## What to check before installing

Before installing, review:

- the overall audit status
- the risk level
- any listed findings
- required credentials, permissions, or environment variables
- owner, source, version, changelog, downloads, stars, and other trust signals

Install only content you understand and trust.

## Audit status

Audit status tells you how to react to the audit result:

| Status      | Meaning                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| `Pass`      | No visible issue above low risk was found.                                |
| `Review`    | Read the findings before installing. The release may still be legitimate. |
| `Warn`      | Use extra caution. ClawHub found a high-impact concern or warning signal. |
| `Malicious` | Do not install.                                                           |
| `Pending`   | Audits have not finished yet.                                             |
| `Error`     | The audit could not be completed.                                         |

A `Pass` is reassuring, but it does not replace your own judgment. This matters
most for tools that can publish content, edit data, run commands, read files, or
access production systems.

## Risk level

Risk level describes blast radius: how much power the release appears to have if
you use it as intended.

| Risk level | Meaning                                                                       |
| ---------- | ----------------------------------------------------------------------------- |
| `Low`      | Little sensitive authority or user impact was found.                          |
| `Medium`   | The release has meaningful authority, such as account access or data changes. |
| `High`     | The release has high-impact authority, severe findings, or malicious signals. |

Risk level and audit status answer different questions:

- Risk level asks: "How much power is here?"
- Audit status asks: "What should I do with this result?"

For example, a publishing skill may show `Review` with `Medium` risk. That does
not mean it is malicious. It means the skill appears purpose-aligned, but can
act with meaningful account authority.

## Findings

Findings explain why an audit result was shown. Each finding usually includes:

- what it means
- why it was flagged
- the relevant skill or plugin content
- a recommendation

Findings may be labeled `Info`, `Low`, `Medium`, `High`, or `Critical`. Higher
severity findings contribute more strongly to risk level and audit status.

Low-confidence findings are hidden from the public audit rollup so the page
stays focused on useful evidence.

## What ClawHub checks

ClawHub audits submitted release artifacts, including:

- skill instructions or plugin metadata
- declared environment variables and permissions
- install instructions and package metadata
- included files and file manifests
- compatibility and capability metadata
- optional publisher notes explaining unusual behavior

The main question is coherence: do the name, summary, metadata, requested
authority, and actual content line up with what users would reasonably expect?

Powerful behavior is not automatically bad. Many useful tools need credentials,
local commands, provider APIs, or package installs. The audit checks whether that
power is expected, disclosed, and proportionate.

## ClawScan

ClawScan is ClawHub's own security audit system. It reviews each release as an
agent-facing artifact: instructions, metadata, declared permissions, files,
capability signals, static scan signals, and publisher-provided context.

ClawScan uses the OWASP Agentic AI Top 10 as a lens for risks such as prompt
injection, tool misuse, credential exposure, unsafe execution, memory or context
poisoning, and excessive agency.

ClawScan does not treat a scary-looking capability as automatically malicious.
It asks whether the capability is disclosed, purpose-aligned, and supported by
the release's stated use case.

## VirusTotal

ClawHub also uses VirusTotal as part of the audit stack. VirusTotal is a trusted
industry standard for file reputation and malware scanning, and our partnership
lets ClawHub add that broader security intelligence to skill and plugin review.

VirusTotal is especially useful for known malicious artifacts, engine hits, and
reputation signals that complement ClawScan's agent-aware review.

## Publisher notes

Publishers can add a ClawScan note when publishing a skill or plugin. This note
can explain behavior that may otherwise look unusual, such as network access,
native host access, credentials, or broad provider APIs.

Publisher notes help reduce false positives, but they are not trusted proof.
ClawHub treats them as context and still checks the submitted artifacts.
