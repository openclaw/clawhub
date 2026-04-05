---
name: media-composition
description: |
  Combine media assets (GIFs, videos) into composite tutorials with vertical/horizontal
version: 1.8.1
triggers:
  - composition
  - ffmpeg
  - media
  - combine
  - stitch
  - tutorial
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/scry", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.scry:gif-generation"]}}}
source: claude-night-market
source_plugin: scry
---

> **Night Market Skill** — ported from [claude-night-market/scry](https://github.com/athola/claude-night-market/tree/master/plugins/scry). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [Required TodoWrite Items](#required-todowrite-items)
- [Manifest Format](#manifest-format)
- [Manifest Schema](#manifest-schema)
- [Step-by-Step Process](#step-by-step-process)
- [1. Parse Manifest File](#1-parse-manifest-file)
- [2. Validate Component Outputs](#2-validate-component-outputs)
- [3. Execute FFmpeg Composition](#3-execute-ffmpeg-composition)
- [4. Verify Combined Output](#4-verify-combined-output)
- [FFmpeg Composition Commands](#ffmpeg-composition-commands)
- [Vertical Stacking](#vertical-stacking)
- [Horizontal Stacking](#horizontal-stacking)
- [Sequential Concatenation](#sequential-concatenation)
- [Grid Layout (2x2)](#grid-layout-(2x2))
- [With Background Color](#with-background-color)
- [Layout Options](#layout-options)
- [Layout Option Details](#layout-option-details)
- [Example Compositions](#example-compositions)
- [Terminal + Browser Tutorial](#terminal-+-browser-tutorial)
- [Side-by-Side Comparison](#side-by-side-comparison)
- [Picture-in-Picture](#picture-in-picture)
- [Exit Criteria](#exit-criteria)


# Media Composition Skill

Combine multiple media assets (GIFs, videos, images) into composite outputs for detailed tutorials and documentation.


## When To Use

- Combining multiple media outputs into compositions
- Creating composite demos from terminal and browser recordings

## When NOT To Use

- Single-format output that does not need composition
- Simple terminal recordings - use scry:vhs-recording directly

## Overview

This skill orchestrates the combination of separately generated media assets into unified outputs. It reads manifest files that define components and their composition rules, validates all inputs exist, and executes FFmpeg commands to produce the final composite media.

## Required TodoWrite Items

```
- Parse composition manifest file
- Validate all component outputs exist
- Determine composition layout and parameters
- Execute FFmpeg composition command
- Verify combined output file created
- Report composition metrics (file size, dimensions)
```
**Verification:** Run the command with `--help` flag to verify availability.

## Manifest Format

Manifests define the components to combine and how to arrange them:

```yaml
# Example manifest: tutorials/mcp.manifest.yaml
name: mcp
title: "MCP Server Integration"
components:
  - type: tape
    source: mcp.tape
    output: assets/gifs/mcp-terminal.gif
  - type: playwright
    source: browser/mcp-browser.spec.ts
    output: assets/gifs/mcp-browser.gif
    requires:
      - "skrills serve"
combine:
  output: assets/gifs/mcp-combined.gif
  layout: vertical
  options:
    padding: 10
    background: "#1a1a2e"
```
**Verification:** Run the command with `--help` flag to verify availability.

### Manifest Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Identifier for the composition |
| `title` | string | No | Human-readable title |
| `components` | array | Yes | List of media components to combine |
| `components[].type` | string | Yes | Source type: `tape`, `playwright`, `static` |
| `components[].source` | string | Yes | Path to source file |
| `components[].output` | string | Yes | Path to generated output |
| `components[].requires` | array | No | Commands to run before generation |
| `combine.output` | string | Yes | Path for combined output |
| `combine.layout` | string | Yes | Layout mode (see table below) |
| `combine.options` | object | No | Layout-specific options |

## Step-by-Step Process

### 1. Parse Manifest File

```bash
# Read and validate manifest structure
yq eval '.' manifest.yaml

# Extract component outputs
yq eval '.components[].output' manifest.yaml
```
**Verification:** Run the command with `--help` flag to verify availability.

### 2. Validate Component Outputs

```bash
# Check all required files exist
for output in $(yq eval '.components[].output' manifest.yaml); do
  if [[ ! -f "$output" ]]; then
    echo "ERROR: Missing component: $output"
    exit 1
  fi
done
```
**Verification:** Run the command with `--help` flag to verify availability.

### 3. Execute FFmpeg Composition

Based on the layout specified in the manifest, execute the appropriate FFmpeg command.

### 4. Verify Combined Output

```bash
# Verify output exists and has content
if [[ -f "$output" && -s "$output" ]]; then
  echo "Composition successful: $output"
  ls -lh "$output"
else
  echo "ERROR: Composition failed"
  exit 1
fi
```
**Verification:** Run the command with `--help` flag to verify availability.

## FFmpeg Composition Commands

### Vertical Stacking

Stack GIFs/videos top to bottom:

```bash
ffmpeg -i top.gif -i bottom.gif \
  -filter_complex "[0:v][1:v]vstack=inputs=2" \
  -y output.gif
```
**Verification:** Run the command with `--help` flag to verify availability.

With padding between:

```bash
ffmpeg -i top.gif -i bottom.gif \
  -filter_complex "[0:v]pad=iw:ih+10:0:0:color=black[top];[top][1:v]vstack=inputs=2" \
  -y output.gif
```
**Verification:** Run the command with `--help` flag to verify availability.

### Horizontal Stacking

Stack GIFs/videos side by side:

```bash
ffmpeg -i left.gif -i right.gif \
  -filter_complex "[0:v][1:v]hstack=inputs=2" \
  -y output.gif
```
**Verification:** Run the command with `--help` flag to verify availability.

### Sequential Concatenation

Play GIFs/videos one after another:

```bash
# Create concat list file
cat > concat_list.txt << EOF
file 'first.gif'
file 'second.gif'
file 'third.gif'
EOF

# Concatenate
ffmpeg -f concat -safe 0 -i concat_list.txt \
  -y output.gif
```
**Verification:** Run the command with `--help` flag to verify availability.

### Grid Layout (2x2)

```bash
ffmpeg -i tl.gif -i tr.gif -i bl.gif -i br.gif \
  -filter_complex "[0:v][1:v]hstack=inputs=2[top];[2:v][3:v]hstack=inputs=2[bottom];[top][bottom]vstack=inputs=2" \
  -y output.gif
```
**Verification:** Run the command with `--help` flag to verify availability.

### With Background Color

```bash
ffmpeg -i top.gif -i bottom.gif \
  -filter_complex "color=c=#1a1a2e:s=800x600[bg];[bg][0:v]overlay=0:0[tmp];[tmp][1:v]overlay=0:300" \
  -y output.gif
```
**Verification:** Run the command with `--help` flag to verify availability.

## Layout Options

| Layout | Description | Options |
|--------|-------------|---------|
| `vertical` | Stack top to bottom | `padding`, `background`, `align` |
| `horizontal` | Stack left to right | `padding`, `background`, `align` |
| `sequential` | Play in order | `transition`, `duration` |
| `grid` | N x M grid arrangement | `rows`, `cols`, `padding` |
| `overlay` | Layer on top of each other | `position`, `opacity` |
| `pip` | Picture-in-picture | `corner`, `scale`, `margin` |

### Layout Option Details

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `padding` | int | 0 | Pixels between components |
| `background` | string | "black" | Background color (hex or name) |
| `align` | string | "center" | Alignment: left, center, right |
| `transition` | string | "none" | Transition type: fade, wipe, none |
| `scale` | float | 0.25 | Scale factor for PiP |
| `corner` | string | "br" | PiP corner: tl, tr, bl, br |

## Example Compositions

### Terminal + Browser Tutorial

```yaml
name: plugin-demo
components:
  - type: tape
    source: demo.tape
    output: terminal.gif
  - type: playwright
    source: browser.spec.ts
    output: browser.gif
combine:
  output: demo-combined.gif
  layout: vertical
  options:
    padding: 5
    background: "#0d1117"
```
**Verification:** Run the command with `--help` flag to verify availability.

### Side-by-Side Comparison

```yaml
name: before-after
components:
  - type: static
    source: before.gif
    output: before.gif
  - type: static
    source: after.gif
    output: after.gif
combine:
  output: comparison.gif
  layout: horizontal
  options:
    padding: 10
```
**Verification:** Run the command with `--help` flag to verify availability.

### Picture-in-Picture

```yaml
name: pip-demo
components:
  - type: tape
    source: main.tape
    output: main.gif
  - type: playwright
    source: overlay.spec.ts
    output: overlay.gif
combine:
  output: pip-demo.gif
  layout: pip
  options:
    corner: br
    scale: 0.3
    margin: 20
```
**Verification:** Run the command with `--help` flag to verify availability.

## Exit Criteria

- [ ] Manifest file parsed successfully
- [ ] All component outputs validated as existing
- [ ] FFmpeg composition command executed without errors
- [ ] Combined output file exists and has non-zero size
- [ ] Output dimensions and duration logged
- [ ] Temporary files cleaned up
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
