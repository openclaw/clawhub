# ClawHub UI Proof

Status: pass
Mode: `before-after`
Route: `https://clawhub.ai/skills-sh/skills-101/superpowers/ai-video-generation`
Baseline: current public page
Candidate: `56244ba1aa18bfacb2356ea8249e7169be2367dd`
Runner: system Chrome
Provider: public real-app state with the exact candidate taxonomy CSS overlaid after hydration

The production baseline and candidate use the same real ClawHub route and rendered data. The candidate lane overlays only the final taxonomy CSS from the exact PR head because the local shared dependency target cannot resolve the current main branch's `@openclaw/krillswitch-react` import and installing or copying dependencies is prohibited for this lane.

Candidate assertions: all semantic units have one client rect, page overflow is zero, three categories occupy more than one row at 320px, mobile dividers have visible 1x14px boxes, taxonomy and handle weight are 400, and the 12px handle remains smaller than the display name.
