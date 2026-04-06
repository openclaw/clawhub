---
name: uri-construction
description: >-
  Rules for constructing URIs accepted by the markitdown
  MCP convert_to_markdown tool.
estimated_tokens: 200
---

# URI Construction

The `convert_to_markdown` MCP tool accepts a single `uri`
parameter. The URI scheme determines how the document is
located.

## Supported Schemes

### `file://` -- Local Files

Prefix the absolute path with `file://`:

```
file:///home/user/documents/report.docx
file:///tmp/downloaded.pdf
```

**Path resolution rules:**

- Always use absolute paths (start with `/`)
- Expand `~` to the full home directory path first
- Resolve relative paths against the working directory
  before prefixing
- Spaces in paths: encode as `%20` or quote the URI

**Example resolution:**

```
Input:  ~/docs/report.docx
Step 1: /home/user/docs/report.docx
Step 2: file:///home/user/docs/report.docx
```

### `http://` and `https://` -- Remote URLs

Use the URL as-is:

```
https://arxiv.org/pdf/2301.00001v1
https://example.com/slides.pptx
```

No transformation needed. The MCP server fetches the
remote resource.

### `data:` -- Inline Content

For content already in memory (rare):

```
data:application/pdf;base64,JVBERi0xLjQK...
```

Format: `data:<mediatype>;base64,<base64-encoded-data>`

This is mainly useful for programmatic integrations,
not typical skill workflows.

## Common Patterns

| Source | URI Construction |
|--------|-----------------|
| User says "convert ~/file.pdf" | Resolve `~`, prefix `file://` |
| URL from WebSearch result | Use URL directly |
| arXiv PDF link | Use `https://arxiv.org/pdf/...` directly |
| File path from Glob/Read | Prefix with `file://` |
| Google Drive link | Use the URL (may need public sharing) |

## Error Cases

- **File not found**: Verify the path exists with Read
  before constructing the URI
- **Permission denied**: Check file permissions
- **URL unreachable**: Try WebFetch first to confirm
  accessibility
- **Unsupported scheme**: Only `file://`, `http://`,
  `https://`, and `data:` are supported
