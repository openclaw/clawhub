# Scanner information tooltip proof

Baseline: ead4d9a0b9. Candidate: 6a9a4c81654bf056cffa507325193f2eea32a9b1.

Real running ClawHub pages in Chrome; light theme, signed out, en-US, UTC. No mocks or generated HTML. Each screenshot opened and inspected.

- NVIDIA: `/steipete/skills/gifgrep/security-audit`, Gifgrep 1.0.1. Baseline http://127.0.0.1:3737, candidate http://127.0.0.1:3735. Both use https://wry-manatee-359.convex.cloud public read backend.
- Tencent: `/local/skills/local-agentic-risk-demo/security-audit`, version 0.1.0, five findings. Baseline http://127.0.0.1:3738, candidate http://127.0.0.1:3736. Both use existing local Convex http://127.0.0.1:3210. Backend state unmodified.
- Viewports: desktop 1440x900, mobile 390x844.
- Assertions: info icons replace vendor bylines; hovered cards show maker and concise description; Learn more is on a separate bottom line and opens the correct repository; keyboard activation focuses the link and Escape returns focus; both mobile touch checks pass; no page errors or card overflow.
- Loading/unavailable states omit the attribution; other data states are unrelated to the trigger/card. A short recording shows both hover/link/keyboard flows (navigation startup trimmed, otherwise real recorded browser frames). Clean and five-finding cases cover typical/content-heavy presentation.
- Checks: ci:static exit 0; ci:unit exit 0 (6492 passed, 3 skipped); targeted scanner suite exit 0 (42 passed), and ci:types-build exit 0.
