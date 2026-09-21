# ClawHub UI Proof
Status: pass
Mode: `before-after`
Scenario: `/home/openclaw/.openclaw/worktrees/e68a56dd99b24988/plugins-first-landing/.artifacts/proof-scenarios/plugins-first.pw.ts`
Baseline: `origin/main`
Candidate: `worktree`
Runner: `local`
Provider: `local`
## Artifacts
### baseline

- Output: `/home/openclaw/.openclaw/worktrees/e68a56dd99b24988/plugins-first-landing/.artifacts/plugins-first-proof/baseline`
- pass: Landing default - `baseline/screenshots/landing-default.png`
- pass: Skills Featured first - `baseline/screenshots/skills-featured-first.png`
- pass: Mobile Skills ordering - `baseline/screenshots/mobile-skills-ordering.png`

### candidate

- Output: `/home/openclaw/.openclaw/worktrees/e68a56dd99b24988/plugins-first-landing/.artifacts/plugins-first-proof/candidate`
- pass: Landing default - `candidate/screenshots/landing-default.png`
- pass: Skills Featured first - `candidate/screenshots/skills-featured-first.png`
- pass: Mobile Skills ordering - `candidate/screenshots/mobile-skills-ordering.png`


## Capture context

Real local ClawHub app, baseline http://127.0.0.1:4338 and candidate http://127.0.0.1:4337, live public catalog data; no backend writes or synthetic UI. Light theme, desktop 1280×900 and mobile 390×844. Published images are browser viewport captures of the same asserted states. Chromium public Convex HTTP queries were forwarded through the runner’s normal managed fetch because Chromium lacks host egress-proxy authentication; data was not replaced. Unrelated third-party artwork and Convex WebSocket subscriptions may be unavailable in this environment. Landing and Skills controls/rows are loaded and asserted.
