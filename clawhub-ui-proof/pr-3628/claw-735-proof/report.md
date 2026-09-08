# Scanner vendor-logo removal proof

Baseline: ead4d9a0b9. Candidate: c3315251caec9e269759d3dac3161a056aeadcd0.

Real running ClawHub pages in Chrome; light theme, signed out, en-US, UTC. No mocks or generated HTML. Each screenshot opened and inspected.

- NVIDIA: `/steipete/skills/gifgrep/security-audit`, Gifgrep 1.0.1. Baseline http://127.0.0.1:3737, candidate http://127.0.0.1:3735. Both use https://wry-manatee-359.convex.cloud public read backend.
- Tencent: `/local/skills/local-agentic-risk-demo/security-audit`, version 0.1.0, five findings. Baseline http://127.0.0.1:3738, candidate http://127.0.0.1:3736. Both use existing local Convex http://127.0.0.1:3210. Backend state unmodified.
- Viewports: desktop 1440x900, mobile 390x844.
- Assertions: attribution image count 1 before and 0 after for both vendors at both viewports; scanner section text identical; no page errors.
- Loading/unavailable states omit the attribution; other data states and video are unrelated to static image removal. Clean and five-finding cases cover typical/content-heavy presentation.
- Checks: ci:static exit 0; ci:unit exit 0 (6492 passed, 3 skipped); targeted scanner suite exit 0 (42 passed).
