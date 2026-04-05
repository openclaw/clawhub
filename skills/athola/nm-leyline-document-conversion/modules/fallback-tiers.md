---
name: fallback-tiers
description: >-
  Per-format instructions for each conversion tier.
  The operational core of the document-conversion skill.
estimated_tokens: 400
---

# Fallback Tier Instructions

## Tier 1: MCP markitdown

For all supported formats, the approach is the same:

1. Construct the URI (see `modules/uri-construction.md`)
2. Call `convert_to_markdown` with the URI
3. If the call succeeds, the result is markdown text
4. Apply `leyline:content-sanitization` to the output

**Detecting Tier 1 availability**: If the MCP tool call
returns an error like "tool not found", "server not
running", or "connection refused", Tier 1 is unavailable.
Proceed to Tier 2.

If the tool exists but returns a conversion error for
the specific file (corrupt file, unsupported variant),
also proceed to Tier 2.

## Tier 2: Native Tool Fallbacks

### PDF

Use the Read tool with the `pages` parameter:

```
Read(file_path="/path/to/file.pdf", pages="1-20")
```

For remote PDFs, first fetch with WebFetch to get a
local path or use the URL directly with Read if supported.

**Chunking strategy for large PDFs:**

- Pages 1-20: first chunk
- Pages 21-40: second chunk
- Continue in 20-page increments
- Concatenate results

**Limitations**: Tables render as plain text. Equations
are lost. Scanned pages produce no text. Images are
not extracted.

### HTML

Use WebFetch with the URL:

```
WebFetch(url="https://example.com/article.html")
```

**Limitations**: Includes navigation, headers, footers,
and boilerplate. Manually identify the main content
section and discard the rest.

### Images (PNG, JPG, GIF, WebP)

Use the Read tool to display the image visually:

```
Read(file_path="/path/to/image.png")
```

Claude sees the image and can describe its contents.

**Limitations**: No OCR text extraction. No EXIF metadata.
Good for visual inspection, not for extracting text from
screenshots or scanned documents.

### CSV

Use the Read tool to get raw comma-separated text:

```
Read(file_path="/path/to/data.csv")
```

Then format the first N rows as a markdown table manually
if needed for presentation.

### JSON and XML

Use the Read tool directly. The structured format is
readable as-is. Summarize or extract relevant sections
rather than converting the entire file.

## Tier 3: User Notification

For formats with no Tier 2 coverage, inform the user.

**Formats requiring Tier 3:**
DOCX, PPTX, XLSX/XLS, MSG, audio (MP3/WAV/M4A),
ZIP archives, EPUB.

**Notification template:**

> This {format} file requires the markitdown MCP server
> for conversion. Without it, I cannot extract the content.
>
> **Option A**: Install markitdown-mcp by adding to
> `.mcp.json`:
> ```json
> {"mcpServers": {"markitdown": {"type": "stdio",
>   "command": "uvx", "args": ["markitdown-mcp"]}}}
> ```
>
> **Option B**: Convert the file to PDF or HTML manually,
> then I can process it with built-in tools.

**Do NOT guess or fabricate content** from a document you
cannot read. Clearly state the limitation.
