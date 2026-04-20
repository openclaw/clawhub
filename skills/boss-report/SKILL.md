# Boss Report — AI Employee Work Summary Skill

> "Boss, every task has a response." 📊

**Description**: Generates comprehensive work summaries (daily, weekly, monthly) for your boss/manager. Outputs to long-term memory and exports as HTML/PDF reports.

**Triggers**: User says "boss report", "report to boss", "work summary", "daily report", "weekly report", "monthly report", or "/boss-report"

---

## Usage

```
/boss-report [daily|weekly|monthly|all] [--format html|pdf|markdown] [--output path]
```

### Commands

| Command | Description |
|---------|-------------|
| `/boss-report daily` | Generate today's work summary |
| `/boss-report weekly` | Generate this week's work summary |
| `/boss-report monthly` | Generate this month's work summary |
| `/boss-report all` | Generate all three (daily + weekly + monthly) |
| `/boss-report daily --format html` | Export daily summary as HTML |
| `/boss-report weekly --format pdf` | Export weekly summary as PDF |
| `/boss-report all --format html --output /path/to/report.html` | Custom output path |

---

## Workflow

### Step 1: Collect Work Data

Gather information from multiple sources:

1. **Session Transcripts** — Check `~/.openclaw/agents/main/sessions/` for recent session files
2. **Memory Files** — Read `memory/YYYY-MM-DD.md` files for daily logs
3. **MEMORY.md** — Check long-term memory for significant events
4. **Git Activity** — Run `git log` across projects for commit history
5. **Docker Containers** — Check container uptime and health status
6. **Cron Jobs** — Review scheduled task execution history
7. **File Changes** — Check recent file modifications in workspace

### Step 2: Analyze & Categorize

Organize findings into these categories:

- **🔧 Tasks Completed** — Finished work items, resolved issues
- **🚀 Projects Progress** — Ongoing project status, milestones reached
- **🐛 Bugs Fixed** — Issues resolved, errors handled
- **📚 Learnings** — New knowledge gained, skills improved
- **⚠️ Challenges** — Obstacles encountered, solutions attempted
- **💡 Ideas** — New ideas generated, improvements suggested
- **📊 Metrics** — Quantifiable results (e.g., commits, messages processed)

### Step 3: Generate Reports

#### Daily Report Structure

```markdown
# 📋 Daily Work Report — {Date}

## Today's Overview
Brief summary of the day's work (2-3 sentences)

## ✅ Completed Tasks
- [List of completed items with details]

## 🔄 In Progress
- [Ongoing tasks with current status]

## 🐛 Issues Resolved
- [Bugs fixed, problems solved]

## 📊 Key Metrics
- Sessions handled: X
- Tasks completed: X
- Commits made: X
- Containers managed: X

## 💡 Notes & Learnings
- [Key takeaways from the day]

## 📅 Tomorrow's Plan
- [Planned tasks for next day]
```

#### Weekly Report Structure

```markdown
# 📊 Weekly Work Report — Week {N}, {Date Range}

## Week Overview
Summary of the week's major accomplishments

## 🏆 Major Achievements
- [Significant accomplishments this week]

## 📈 Project Status
| Project | Progress | Status | Notes |
|---------|----------|--------|-------|
| [Name] | [X%] | 🟢/🟡/🔴 | [Details] |

## 📝 Day-by-Day Summary
| Day | Key Work | Hours |
|-----|----------|-------|
| Mon | [Summary] | - |
| Tue | [Summary] | - |
| Wed | [Summary] | - |
| Thu | [Summary] | - |
| Fri | [Summary] | - |

## 📊 Weekly Metrics
- Total tasks completed: X
- Total commits: X
- Issues resolved: X
- Documents written: X

## 🎯 Next Week's Goals
- [Planned objectives for next week]
```

#### Monthly Report Structure

```markdown
# 📈 Monthly Work Report — {Month Year}

## Monthly Overview
High-level summary of the month's work

## 🏆 Key Achievements
- [Major accomplishments this month]

## 📊 Project Portfolio
| Project | Status | Progress | Impact |
|---------|--------|----------|--------|
| [Name] | [Active/Completed/Paused] | [X%] | [Description] |

## 📅 Weekly Breakdown
| Week | Focus | Output |
|------|-------|--------|
| Week 1 | [Theme] | [Summary] |
| Week 2 | [Theme] | [Summary] |
| Week 3 | [Theme] | [Summary] |
| Week 4 | [Summary] | [Summary] |

## 📈 Monthly Metrics
- Total tasks: X
- Total commits: X
- Pull requests: X
- Issues closed: X
- Documents created: X

## 🎓 Skills & Learnings
- [New skills acquired]
- [Knowledge areas improved]

## 🎯 Next Month's Objectives
- [Goals for next month]
```

### Step 4: Save to Long-Term Memory

Save the report to the appropriate memory file:

```bash
# Daily
memory/YYYY-MM-DD.md → Append report to daily log

# Weekly
memory/weekly/YYYY-W{N}.md → Create weekly summary

# Monthly
memory/monthly/YYYY-MM.md → Create monthly summary
```

Also update `MEMORY.md` with key highlights if significant events occurred.

### Step 5: Export Reports

#### HTML Export

Generate a professional HTML report with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Work Report - {Date}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 40px 20px; background: #f5f5f5; }
        .container { background: white; border-radius: 12px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        h1 { color: #1a1a2e; border-bottom: 3px solid #4a90d9; padding-bottom: 12px; }
        h2 { color: #16213e; margin-top: 32px; }
        .metric { display: inline-block; background: #e8f4fd; padding: 12px 20px; border-radius: 8px; margin: 8px; text-align: center; }
        .metric .number { font-size: 2em; font-weight: bold; color: #4a90d9; }
        .metric .label { font-size: 0.9em; color: #666; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
        th { background: #f8f9fa; font-weight: 600; }
        .status-green { color: #28a745; }
        .status-yellow { color: #ffc107; }
        .status-red { color: #dc3545; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="container">
        <!-- Report content -->
    </div>
</body>
</html>
```

Save to: `memory/reports/report-{YYYY-MM-DD}.html`

#### PDF Export

To generate PDF, use one of these methods:

1. **If `puppeteer` or `playwright` is available**: Render HTML to PDF
2. **If `wkhtmltopdf` is installed**: Convert HTML to PDF directly
3. **Fallback**: Provide the HTML file with instructions to print-to-PDF

Save to: `memory/reports/report-{YYYY-MM-DD}.pdf`

### Step 6: Deliver Report

Send the report to the user via the current channel with:

1. **Text summary** in the chat
2. **File attachment** for HTML/PDF if requested
3. **Confirmation message**: "Boss, report delivered! Every task has a response. 🦞"

---

## Example Output

### Chat Summary (always shown)

```
📊 **Daily Work Report — 2026-04-20**

**Today's Overview:**
Handled 23 user requests, managed 5 Docker containers, fixed 2 critical bugs, and contributed 1 PR to OpenClaw upstream.

**✅ Completed:**
- Fixed session reset bug in OpenClaw (#58605)
- Updated all container model configurations
- Created boss-report skill

**📊 Metrics:**
- Sessions: 23 | Tasks: 12 | Commits: 5 | PRs: 1

Full HTML report saved to: `memory/reports/report-2026-04-20.html`

Boss, report delivered! Every task has a response. 🦞
```

---

## Memory File Templates

### Daily Log (`memory/YYYY-MM-DD.md`)

```markdown
# {YYYY-MM-DD}

## Work Summary
[Brief overview]

## Tasks Completed
- [ ] Item 1
- [ ] Item 2

## Issues & Resolutions
- Issue: [Description]
  Resolution: [How it was fixed]

## Metrics
- Sessions: X
- Commits: X
- PRs: X

## Notes
[Any additional notes]
```

---

## Error Handling

| Scenario | Action |
|----------|--------|
| No session data found | Use available memory files, note data limitations |
| No memory files exist | Create fresh files with today's date |
| Export format unavailable | Use fallback method, inform user |
| Git repos not found | Skip git metrics, note in report |

---

## Configuration

Store user preferences in skill config:

```json
{
  "bossReport": {
    "defaultFormat": "markdown",
    "autoSaveToMemory": true,
    "includeMetrics": true,
    "includeTomorrowPlan": true,
    "outputDir": "memory/reports",
    "htmlTheme": "professional"
  }
}
```

---

## Best Practices

1. **Be specific** — Use exact numbers and details, not vague statements
2. **Be honest** — Report challenges and blockers, not just successes
3. **Be concise** — Bosses want key info, not a novel
4. **Be proactive** — Include tomorrow's plan and next week's goals
5. **Be professional** — This is a work document, keep it polished
6. **Be consistent** — Use the same format every time for easy comparison

---

*Skill created by OpenClaw Main Agent. "Boss, every task has a response." 🦞*
