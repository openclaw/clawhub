---
name: format-matrix
description: >-
  Document format support matrix showing conversion quality
  across the three fallback tiers.
estimated_tokens: 300
---

# Format Support Matrix

Quality ratings: High (preserves structure, tables, images),
Medium (readable but loses some formatting), Low (raw text
or visual only), None (not supported at this tier).

## Office Documents

| Format | Tier 1 (markitdown) | Tier 2 (native) | Notes |
|--------|---------------------|------------------|-------|
| PDF | High: structure, tables, OCR | Medium: Read tool, 20pp chunks | Native loses table formatting |
| DOCX | High: headings, lists, tables | None | Tier 3 only without markitdown |
| PPTX | High: slide-by-slide, speaker notes | None | Tier 3 only |
| XLSX/XLS | High: tables to markdown | None | Tier 3 only |
| MSG | High: email headers + body | None | Outlook format, Tier 3 only |

## Web and Data Formats

| Format | Tier 1 (markitdown) | Tier 2 (native) | Notes |
|--------|---------------------|------------------|-------|
| HTML | High: clean extraction | Medium: WebFetch | WebFetch includes boilerplate |
| CSV | High: formatted tables | Medium: Read (raw) | Native readable but unformatted |
| JSON | High: structured output | Medium: Read (raw) | Native usually sufficient |
| XML | High: structured output | Medium: Read (raw) | Native usually sufficient |

## Media Formats

| Format | Tier 1 (markitdown) | Tier 2 (native) | Notes |
|--------|---------------------|------------------|-------|
| Images | High: OCR + EXIF + description | Low: Read (visual) | Native shows image, no text |
| Audio | Medium: speech transcription | None | Tier 3 only |

## Archive and Other

| Format | Tier 1 (markitdown) | Tier 2 (native) | Notes |
|--------|---------------------|------------------|-------|
| ZIP | High: extracts and converts contents | None | Tier 3 only |
| EPUB | High: e-book to markdown | None | Tier 3 only |

## Decision Guide

**When Tier 2 is good enough** (skip markitdown if unavailable):

- PDF with mostly text (no complex tables or equations)
- HTML articles (WebFetch handles well)
- CSV/JSON/XML (Read tool is fine for structured data)
- Images where visual inspection suffices

**When Tier 1 matters most** (strongly prefer markitdown):

- PDFs with tables, equations, or scanned content
- Office documents (DOCX, PPTX, XLSX) -- no Tier 2 at all
- Images requiring text extraction (OCR)
- Audio files requiring transcription
