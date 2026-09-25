# ClawHub UI Proof
Status: pass
Mode: `before-after`
Scenario: `/Users/patrickerichsen/Git/openclaw/clawhub-inline-audit/.artifacts/proof-scenarios/scanner-evidence.pw.ts`
Baseline: `0ae54008b3`
Candidate: `0e4a3b64f0c61fb4c1f5fd868c076accf55e93bb`
Runner: `local`
Provider: `local`
## Artifacts
### baseline

- Output: `/Users/patrickerichsen/Git/openclaw/clawhub-inline-audit/.artifacts/skillspector-investigation/proof/baseline`
- pass: AIG compact rows 1440px dark - `baseline/screenshots/aig-compact-rows-1440px-dark.png`
- pass: SkillSpector scanner context 1440px dark - `baseline/screenshots/skillspector-scanner-context-1440px-dark.png`
- pass: SkillSpector missing excerpt 1440px dark - `baseline/screenshots/skillspector-missing-excerpt-1440px-dark.png`
- pass: SkillSpector source code 1440px dark - `baseline/screenshots/skillspector-source-code-1440px-dark.png`
- pass: AIG compact rows 390px dark - `baseline/screenshots/aig-compact-rows-390px-dark.png`
- pass: SkillSpector scanner context 390px dark - `baseline/screenshots/skillspector-scanner-context-390px-dark.png`
- pass: SkillSpector missing excerpt 390px dark - `baseline/screenshots/skillspector-missing-excerpt-390px-dark.png`
- pass: SkillSpector source code 390px dark - `baseline/screenshots/skillspector-source-code-390px-dark.png`

### candidate

- Output: `/Users/patrickerichsen/Git/openclaw/clawhub-inline-audit/.artifacts/skillspector-investigation/proof/candidate`
- pass: AIG compact rows 1440px dark - `candidate/screenshots/aig-compact-rows-1440px-dark.png`
- pass: SkillSpector scanner context 1440px dark - `candidate/screenshots/skillspector-scanner-context-1440px-dark.png`
- pass: SkillSpector missing excerpt 1440px dark - `candidate/screenshots/skillspector-missing-excerpt-1440px-dark.png`
- pass: SkillSpector source code 1440px dark - `candidate/screenshots/skillspector-source-code-1440px-dark.png`
- pass: AIG compact rows 390px dark - `candidate/screenshots/aig-compact-rows-390px-dark.png`
- pass: SkillSpector scanner context 390px dark - `candidate/screenshots/skillspector-scanner-context-390px-dark.png`
- pass: SkillSpector missing excerpt 390px dark - `candidate/screenshots/skillspector-missing-excerpt-390px-dark.png`
- pass: SkillSpector source code 390px dark - `candidate/screenshots/skillspector-source-code-390px-dark.png`
- pass: AIG expanded report - `candidate/screenshots/aig-expanded-report.png`
- pass: SkillSpector highlighted source light - `candidate/screenshots/skillspector-highlighted-source-light.png`


## Evidence context

Screenshots come from real running ClawHub instances in Playwright, using public release-validation 0.1.7 data without mocks or backend mutations. Baseline: http://127.0.0.1:3041/openclaw/skills/release-validation/security-audit at 0ae54008b3. Candidate: http://127.0.0.1:3042/openclaw/skills/release-validation/security-audit from the unchanged working tree committed as 0e4a3b64f0c61fb4c1f5fd868c076accf55e93bb.

All 18 screenshots were visually inspected. Coverage includes the A.I.G collapsed and expanded report, SkillSpector scanner context, absent source evidence, JavaScript source excerpts, desktop/mobile layouts, dark/light highlighting, and tablet/laptop overflow assertions. A.I.G analysis and remediation open/close interactions pass. Existing loading/error/empty page behavior is unchanged and covered by component tests.
