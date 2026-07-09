# Cost Analysis Report Template

Use this template when presenting findings from the controlling-costs workflow.

---

## Cost Analysis Report: [Deployment Name]

**Date:** [YYYY-MM-DD]  
**Analyst:** [Name]  
**Audit Dataset:** [dataset name]  
**Analysis Period:** [e.g., Last 30 days]

---

### Executive Summary

| Metric | Value |
|--------|-------|
| Daily Ingest (avg) | X TB/day |
| Daily Ingest (p95) | X TB/day |
| Contract Limit | X TB/day |
| Over/Under Contract | +X% / -X% |
| Estimated Monthly Cost | $X |
| Potential Savings | $X (X%) |

**Key Finding:** [One sentence summary of the biggest opportunity]

---

### Top Datasets by Ingest

| Rank | Dataset | 30d Ingest (TB) | % of Total | Work/GB | Action |
|------|---------|-----------------|------------|---------|--------|
| 1 | dataset-a | X | X% | X | [Recommendation] |
| 2 | dataset-b | X | X% | X | [Recommendation] |
| 3 | dataset-c | X | X% | X | [Recommendation] |

**Work/GB Key:**
- 0 = Never queried (🔴 drop candidate)
- <100 = Rarely queried (🟡 sample candidate)
- >1000 = Actively used (🟢 keep)

---

### Waste Candidates

Datasets with high ingest but low query activity:

| Dataset | Ingest (GB) | Query Cost (GB·ms) | Work/GB | Recommendation |
|---------|-------------|-------------------|---------|----------------|
| dataset-x | X | X | X | [Action] |

**Estimated Savings:** X TB/day (X% reduction)

---

### Field-Level Analysis: [Dataset Name]

#### Unused Columns

Found **X unused columns** out of Y total (X% waste potential).

Top unused columns by estimated size:
1. `field.name.a` - never referenced
2. `field.name.b` - never referenced
3. `field.name.c` - never referenced

**Recommendation:** Consider dropping at ingest or restructuring schema.

#### High-Volume Unqueried Values

For field `[field_name]`:

| Value | Est. Events/Day | Queried? | Recommendation |
|-------|-----------------|----------|----------------|
| value-a | X M | ❌ No | Drop or sample |
| value-b | X M | ❌ No | Reduce log level |
| value-c | X M | ✅ Yes | Keep |

**Estimated Savings:** X GB/day by excluding unqueried values.

---

### Week-over-Week Changes

| Dataset | Last Week (GB) | This Week (GB) | Δ GB | Δ % | Cause |
|---------|----------------|----------------|------|-----|-------|
| dataset-a | X | X | +X | +X% | [Investigation result] |

---

### Recommendations Summary

#### Immediate Actions (This Week)
1. **[Action 1]** - [Dataset] - Est. savings: X TB/day
2. **[Action 2]** - [Dataset] - Est. savings: X TB/day

#### Short-Term (2-4 Weeks)
1. **[Action]** - [Details]

#### Long-Term (1-3 Months)
1. **[Action]** - [Details]

---

### Glidepath to Contract

| Week | Target (TB/day) | Status |
|------|-----------------|--------|
| Current | X | 🔴 Over |
| Week 1 | X | |
| Week 2 | X | |
| Week 3 | X | |
| Week 4 (Contract) | X | |

---

### Appendix: Queries Used

<details>
<summary>Click to expand</summary>

**Top datasets by ingest:**
```apl
['audit-dataset'] | where action == 'usageCalculated' ...
```
[View in Axiom](link)

**Waste candidates:**
```apl
...
```
[View in Axiom](link)

</details>
