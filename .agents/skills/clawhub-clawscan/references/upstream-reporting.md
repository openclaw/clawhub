# Report a validated scan or verdict accuracy defect

Use this branch after inspecting the exact submitted artifact and the completed
scan. A publisher's assertion or a different later version is not validation.
Record the evidence that supports or refutes each disputed finding; preserve
independent valid findings. If reproduction remains unavailable, label the
complaint unvalidated and identify the missing input.

## Deduplicate before publishing

Search `openclaw/clawscan` across open and closed issues using the component,
rule/error signature, and reproduction mechanism. A package name alone is a poor
duplicate key. Inspect plausible matches and linked fixes against the affected
source revision. Record the existing issue when it covers the same mechanism;
prepare additional reproduction/version evidence for it rather than filing anew.

Known read commands:

```sh
gh issue list --repo openclaw/clawscan --state all --search '<component and signature>' --limit 100
gh issue view <number> --repo openclaw/clawscan --json title,body,state,labels,url
gh label list --repo openclaw/clawscan --limit 100
```

Use existing component/accuracy labels when available. If none fit, put explicit
attribution tags such as `[SkillSpector] [false-positive]` in the title and a
`Component: skillspector` line in the body. Do not invent repository labels or
change the taxonomy as part of a report. Use `false-positive`, `false-negative`,
or `verdict-interpretation` only when the evidence supports that classification.
For a correct scanner result mapped incorrectly by ClawHub, use
`[ClawHub integration]` attribution and link the primary ClawHub repair. Keep this
ClawScan tracking record distinct from an accusation of a scanner defect.

## Report packet

Prepare one issue body or an addition to the existing issue containing:

- **Identity:** exact target kind, owner/name/version, artifact digest or safe
  fixture, affected run/job/attempt and UTC timestamps; source alert/appeal link
  only when appropriate for the destination's audience.
- **Versions:** ClawHub/worker revision, ClawScan source and runtime image/patches,
  attributed scanner source version, judge/profile/model settings relevant to the
  reproduction. Mark values unavailable rather than filling from current pins.
- **Observed versus expected:** exact relevant scanner finding/rule and final
  verdict, with sanitized evidence excerpts and file/line references. Explain
  why the behavior does or does not support the security claim and whether the
  error originated in scanner evidence, an adapter, or judge interpretation.
- **Reproduction:** minimal safe fixture or permitted artifact reference,
  commands/configuration, result, and limits. Record nondeterminism honestly;
  repeated calls until a benign result appears do not establish correctness.
- **Analysis and route:** confirmed mechanism, remaining uncertainty, component
  owner, duplicate search outcome and related issue/fix links. Include paired
  regression evidence when a general fix is prepared.

Remove credentials, publisher contact data, private staff/appeal content, signed
URLs, and restricted artifacts before publication. Reference a safe fixture or
use the owner's private security channel for sensitive vulnerabilities; do not
publish an exploit or restricted scan bundle merely to complete the packet.

## Publish within authority

If publication is authorized, use the existing issue or create one in
`openclaw/clawscan` with the exact reviewed body through `--body-file`. Return its
direct URL. A draft or an attempted API request is not a published report.
If publication is outside authority, return the body file, proposed title/tags,
deduplication evidence, and exact missing permission to Admin for publication.
If read access is missing, mark deduplication pending instead of claiming a new
issue is needed.

When SkillSpector or Tencent AIG owns the underlying defect, keep the attributed
ClawScan report as the tracking point and link any separately authorized upstream
report. Upstream tracking and a ClawHub appeal decision are independent outcomes.
