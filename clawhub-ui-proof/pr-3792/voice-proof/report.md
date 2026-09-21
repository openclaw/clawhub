# ClawHub UI Proof
Status: pass
Mode: `before-after`
Scenario: `/home/openclaw/.openclaw/worktrees/e68a56dd99b24988/voice-category-microphone-icon/.artifacts/proof-scenarios/voice.pw.ts`
Baseline: `origin/main`
Candidate: `worktree`
Runner: `local`
Provider: `local`
## Artifacts
### baseline

- Output: `/home/openclaw/.openclaw/worktrees/e68a56dd99b24988/voice-category-microphone-icon/.artifacts/voice-proof/baseline`
- pass: Voice category in plugin browser - `baseline/screenshots/voice-category-in-plugin-browser.png`

### candidate

- Output: `/home/openclaw/.openclaw/worktrees/e68a56dd99b24988/voice-category-microphone-icon/.artifacts/voice-proof/candidate`
- pass: Voice category in plugin browser - `candidate/screenshots/voice-category-in-plugin-browser.png`


## Capture context

Real ClawHub app, Chromium, 1280×900, dark theme, `/plugins?category=voice`. Baseline `ff6c118c132ae89b5351739cc45fe9227ff1574e` at http://127.0.0.1:4328; candidate `e17c89a30f78fde903e185f793553370cc89d0e9` at http://127.0.0.1:4327. Both read the public catalog backend; no fixture, mock HTML, or production mutation. The same Voice Call and surrounding plugin rows are visible. Viewport screenshots are selected for legibility.

The changed category icon and filtering are verified; unrelated topic chips remain loading and a remote publisher icon fails in both captures because this environment cannot authenticate the browser WebSocket/remote-image proxy.
