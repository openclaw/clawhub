---
name: papers
description: |
  >- Search academic literature via arXiv, Semantic Scholar, and open-access discovery chains. Fetches and parses PDFs for key findings
version: 1.8.1
triggers:
  - arxiv
  - semantic-scholar
  - academic
  - papers
  - pdf
  - the user needs academic papers
  - citations
  - or formal research on a topic
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/tome", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.leyline:document-conversion"]}}}
source: claude-night-market
source_plugin: tome
---

> **Night Market Skill** — ported from [claude-night-market/tome](https://github.com/athola/claude-night-market/tree/master/plugins/tome). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Academic Papers Search

## When To Use

- Finding academic papers, citations, or formal research
- Building literature reviews or citation chains

## When NOT To Use

- Community opinions (use `/tome:discourse`)
- Code implementations (use `/tome:code-search`)

Search arXiv, Semantic Scholar, and open-access sources.

## Sources (Priority Order)

1. arXiv API (free, unlimited metadata)
2. Semantic Scholar API (100 req/5min, citation graphs)
3. Unpaywall (legal free version discovery)
4. CORE.ac.uk (open-access aggregator)
5. PubMed Central (biomedical)
6. Author preprint pages (WebSearch fallback)

## PDF Processing

After acquiring a paper URL or local file path, convert
the PDF to markdown for better extraction quality.

### Conversion (prefer markitdown)

Apply the `leyline:document-conversion` protocol:

1. **Try markitdown first**: call the MCP `convert_to_markdown`
   tool with the PDF URL or `file://` path. This produces
   structured markdown preserving tables, equations, figures,
   and section hierarchy.

2. **Fall back to Read tool** if markitdown is unavailable:
   - Read with `pages: "1-20"` for the first chunk
   - Continue with `pages: "21-40"` for longer papers
   - Continue in 20-page increments as needed
   - Note: tables and figures will not extract as cleanly

### Extraction Targets

From the converted markdown, extract:

- Abstract and key findings
- Methodology and experimental setup
- Results tables and figures
- Citation information (authors, year, venue)
- Key equations or formal definitions

## Fallback Guidance

When a paper is paywalled and no open version exists:
- Public library JSTOR/ProQuest access via library card
- DeepDyve article rental
- Inter-library loan request
- Direct author email template
