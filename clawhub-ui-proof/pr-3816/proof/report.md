# ClawHub UI Proof
Status: pass
Mode: `before-after`
Scenario: `/Users/patrickerichsen/Git/openclaw/clawhub-inline-audit/.artifacts/proof-scenarios/inline-audit.pw.ts`
Baseline: `73d65ef1df`
Candidate: `22b5b6f85a`
Runner: `local`
Provider: `local`
## Artifacts
### baseline

- Output: `/Users/patrickerichsen/Git/openclaw/clawhub-inline-audit/.artifacts/inline-audit/proof/baseline`
- pass: AIG inline report 1440px dark - `baseline/screenshots/aig-inline-report-1440px-dark.png`
- pass: SkillSpector formatted excerpt 1440px dark - `baseline/screenshots/skillspector-formatted-excerpt-1440px-dark.png`
- pass: AIG inline report 390px dark - `baseline/screenshots/aig-inline-report-390px-dark.png`
- pass: SkillSpector formatted excerpt 390px dark - `baseline/screenshots/skillspector-formatted-excerpt-390px-dark.png`
- pass: AIG inline report 1440px light - `baseline/screenshots/aig-inline-report-1440px-light.png`

### candidate

- Output: `/Users/patrickerichsen/Git/openclaw/clawhub-inline-audit/.artifacts/inline-audit/proof/candidate`
- pass: AIG inline report 1440px dark - `candidate/screenshots/aig-inline-report-1440px-dark.png`
- pass: SkillSpector formatted excerpt 1440px dark - `candidate/screenshots/skillspector-formatted-excerpt-1440px-dark.png`
- pass: AIG inline report 390px dark - `candidate/screenshots/aig-inline-report-390px-dark.png`
- pass: SkillSpector formatted excerpt 390px dark - `candidate/screenshots/skillspector-formatted-excerpt-390px-dark.png`
- pass: AIG inline report 1440px light - `candidate/screenshots/aig-inline-report-1440px-light.png`


## Fixture and scope

Real local ClawHub instances use the same public read-only Convex backend and release-validation 0.1.7 report, at `/openclaw/skills/release-validation/security-audit`. No scanner data was mocked or mutated. Baseline: http://127.0.0.1:3041. Candidate: http://127.0.0.1:3042.

Typical and content-heavy findings are covered in both lanes at 1440×900 and 390×844, with an additional light-theme comparison. Candidate overflow was also checked at 768px and 1366px. Markdown headings/body measure 14px and code 12px; the mobile code-wrap control works. Stored truncation notices remain visible.

Loading/empty/error states are omitted because the patch changes only rendering inside populated finding cards. They remain covered by existing scanner tests. All ten published screenshots were visually inspected.
