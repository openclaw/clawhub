---
name: document-analysis-patterns
description: Document and meeting notes analysis patterns for catchup
parent_skill: imbue:catchup
category: analysis-patterns
tags: [documents, meetings, notes, tracking]
estimated_tokens: 300
---

# Document Analysis Patterns

## Meeting Notes Analysis

When catching up on meeting notes or discussions:

**Context Establishment:**
- Identify date range: "Last meeting I attended was [date]"
- Note participants involved
- Identify meeting series or project name

**Delta Capture:**
- List topics discussed (agenda items)
- Enumerate decisions made
- Identify action items assigned
- Note open questions or blocked items

**Insight Extraction:**
- What changed since last meeting?
- What decisions affect ongoing work?
- What consensus emerged on contentious topics?
- What new information affects project direction?

## Sprint/Ticket Catchup Patterns

For Jira, GitHub Issues, or similar tracking systems:

**Context:**
- Last sprint/milestone reviewed
- Current sprint/milestone
- Team velocity or capacity changes

**Delta:**
- Tickets completed since baseline
- Tickets in progress
- New tickets added to backlog
- Priority shifts or re-ordering

**Insights:**
- Velocity trends (ahead/behind schedule?)
- Risk indicators (blocked tickets, dependencies)
- Scope changes (new requirements, deferred items)
- Team capacity changes

## Document Revision Tracking

When reviewing evolving documents (specs, designs, RFCs):

**Context:**
- Last version reviewed (version number, date, or commit)
- Current version
- Document type and audience

**Delta:**
- Sections added, modified, or removed
- Comments or review feedback incorporated
- Status changes (draft → review → approved)

**Insights:**
- Requirements changes and rationale
- Design decisions made or reversed
- Unresolved discussions or open questions
- Approval status and blockers

## Generic Document Delta Patterns

**Efficient Enumeration:**
- Focus on substantive changes (ignore typos, formatting)
- Identify authors/contributors to understand perspective
- Note timestamp for context
- Track references to external decisions or dependencies

**Token Conservation:**
- Summarize content rather than quoting verbatim
- Reference section headings + key points
- List decisions/actions rather than narrative
- Use bullet points for scanning efficiency
