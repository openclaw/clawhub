---
name: convex-cost
description: "Preview Convex spend — rank functions by bytes/documents-read × call-volume from insights, project each cost driver's growth curve, name the cheapest fix; confirm-cost for paid actions."
---

<!-- GENERATED from convex-agents content/capabilities/convex-cost.json — do not edit by hand. -->

# Preview what this app will cost

Cost surprises come from a handful of functions reading far more data than anyone realized — the same read-heavy patterns convex-advisor flags for perf, seen through the money lens. This capability makes spend legible: it reads the deployment's own bytes/documents-read evidence, attributes it to the functions driving it, projects how it grows with traffic, and names the cheapest fix. It also carries the confirm-cost discipline (Supabase's structural consent for paid actions): before anything metered, state the price and get an explicit yes.

## Workflow

1. GUARD: deploy-guard — a cost read is read-only over dev/prod (insights is cloud+user-auth only; not previews). Announce the deployment.
2. GATHER the spend evidence via the official MCP: `insights` for the bytes-read / documents-read events (the direct cost signal — Convex bills on function calls + bandwidth), `tables` for row counts (a table's size bounds its scan cost), `functionSpec` for the surface. If there's no usage/traffic yet, say so and estimate from the query SHAPES instead (a `.collect()` on a table projected to grow is a future cost even with zero traffic today).
3. ATTRIBUTE: rank functions by bytes/documents read per call × observed (or asked-about) call volume — the product is the cost driver, not either alone. A cheap-per-call function called constantly can outweigh an expensive rare one; show both factors.
4. PROJECT: state how the top drivers scale — a full-table `.collect()` grows LINEARLY with the table (cost compounds as data accumulates); an indexed `.take(n)` stays flat. Give the user the shape of the curve ('this is O(table size) per call — fine at 1k rows, a bill at 1M'), not a false-precision dollar figure.
5. NAME THE CHEAPEST FIX per driver — index + `.withIndex` instead of scan, `.paginate`/`.take` instead of `.collect`, an aggregate component for counts, caching a hot read — and emit it as a cost-class finding on the bus (evidence: the insight event + the projected growth) pointing at convex-expert/convex-advisor for the actual change.
6. CONFIRM-COST for paid actions: if the flow includes anything metered (a domain purchase, cloud provisioning, a plan change), STATE the price and recurrence explicitly and get an explicit yes BEFORE proceeding — never let a paid action happen as a side effect (the cost-confirm gate).
7. REPORT: the current cost drivers ranked, each with its evidence + growth shape + fix, and a plain bottom line ('your spend is dominated by messages:list reading the whole table every call; index it and it drops ~100x'). Honest precision: Convex pricing changes and depends on plan — give relative/shape guidance and cite the pricing page for absolute numbers rather than inventing a dollar total.

## Rules

- Cost = data-read-per-call × call-volume — always show both factors; a cheap function called constantly can cost more than an expensive rare one.
- Read the deployment's own insights/bytes-read evidence for spend; with no traffic yet, price the query SHAPES (a scan on a growing table is a future cost).
- Give the growth CURVE, not false-precision dollars: O(table) scans compound as data accumulates; indexed access stays flat. Cite the pricing page for absolute figures.
- Every cost driver names its cheapest fix and emits a cost-class finding on the bus pointing at the fixer (convex-expert/advisor).
- Confirm-cost for any metered/paid action: state the price + recurrence and get an explicit yes BEFORE it happens — never as a side effect.
- Read-only over dev/prod (deploy-guard); insights is cloud+user-auth only. Cost composes convex-advisor's evidence but frames it as money, not latency.
