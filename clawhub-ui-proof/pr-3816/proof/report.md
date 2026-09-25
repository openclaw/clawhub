# ClawHub UI Proof
Status: pass
Mode: `before-after`
Scenario: `/Users/patrickerichsen/Git/openclaw/clawhub-inline-audit/.artifacts/proof-scenarios/inline-audit.pw.ts`
Baseline: `73d65ef1df`
Candidate: `7d3e845341`
Runner: `local`
Provider: `local`
## Artifacts
### baseline

- Output: `/Users/patrickerichsen/Git/openclaw/clawhub-inline-audit/.artifacts/inline-audit/proof/baseline`
- pass: AIG inline report 1440px dark - `baseline/screenshots/aig-inline-report-1440px-dark.png`
- pass: SkillSpector formatted excerpt 1440px dark - `baseline/screenshots/skillspector-formatted-excerpt-1440px-dark.png`
- pass: AIG inline report 390px dark - `baseline/screenshots/aig-inline-report-390px-dark.png`
- pass: SkillSpector formatted excerpt 390px dark - `baseline/screenshots/skillspector-formatted-excerpt-390px-dark.png`
- pass: AIG remediation label 1440px dark - `baseline/screenshots/aig-remediation-label-1440px-dark.png`
- pass: AIG inline report 1440px light - `baseline/screenshots/aig-inline-report-1440px-light.png`

### candidate

- Output: `/Users/patrickerichsen/Git/openclaw/clawhub-inline-audit/.artifacts/inline-audit/proof/candidate`
- pass: AIG inline report 1440px dark - `candidate/screenshots/aig-inline-report-1440px-dark.png`
- pass: SkillSpector formatted excerpt 1440px dark - `candidate/screenshots/skillspector-formatted-excerpt-1440px-dark.png`
- pass: AIG inline report 390px dark - `candidate/screenshots/aig-inline-report-390px-dark.png`
- pass: SkillSpector formatted excerpt 390px dark - `candidate/screenshots/skillspector-formatted-excerpt-390px-dark.png`
- pass: AIG remediation label 1440px dark - `candidate/screenshots/aig-remediation-label-1440px-dark.png`
- pass: AIG inline report 1440px light - `candidate/screenshots/aig-inline-report-1440px-light.png`


## Evidence context

These are screenshots from real running ClawHub instances in Playwright, using the same public `release-validation` 0.1.7 report. Baseline: `http://127.0.0.1:3041/openclaw/skills/release-validation/security-audit`; candidate: `http://127.0.0.1:3042/openclaw/skills/release-validation/security-audit`. No mocked backend responses or mutations were used.

Coverage includes content-heavy AIG and SkillSpector findings at desktop/mobile widths, light/dark themes, explicit remediation labels, tablet/laptop overflow assertions, compact font-size assertions, and the mobile line-wrap interaction. Existing loading/empty/error behavior is unchanged and remains covered by component tests. All 12 screenshots were visually inspected. The baseline AIG mobile overflow is corrected in the candidate. Plain-text remediation is also covered by a regression assertion.
