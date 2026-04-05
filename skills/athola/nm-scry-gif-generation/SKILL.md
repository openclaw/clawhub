---
name: gif-generation
description: Post-process video files and generate optimized GIFs. Converts webm/mp4
version: 1.8.1
triggers:
  - gif
  - ffmpeg
  - video
  - conversion
  - optimization
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/scry", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: scry
---

> **Night Market Skill** — ported from [claude-night-market/scry](https://github.com/athola/claude-night-market/tree/master/plugins/scry). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [Required TodoWrite Items](#required-todowrite-items)
- [Process](#process)
- [Step 1: Validate Input File](#step-1:-validate-input-file)
- [Step 2: Check ffmpeg Installation](#step-2:-check-ffmpeg-installation)
- [Step 3: Execute Conversion](#step-3:-execute-conversion)
- [Basic Conversion (Fast, Larger File)](#basic-conversion-(fast,-larger-file))
- [High Quality with Palette Generation (Recommended)](#high-quality-with-palette-generation-(recommended))
- [Maximum Quality with Dithering](#maximum-quality-with-dithering)
- [Optimization Options](#optimization-options)
- [Common Presets](#common-presets)
- [Step 4: Verify Output](#step-4:-verify-output)
- [Exit Criteria](#exit-criteria)
- [Troubleshooting](#troubleshooting)
- [Large Output File](#large-output-file)
- [Color Banding](#color-banding)
- [Slow Conversion](#slow-conversion)


# GIF Generation Skill

Post-process video files (webm/mp4) and generate optimized GIF output with configurable quality settings.


## When To Use

- Converting recordings to animated GIF format
- Creating lightweight demo animations

## When NOT To Use

- High-quality video output - use full recording tools
- Static image generation without animation needs

## Overview

This skill handles the conversion of video recordings (typically from browser automation) to GIF format. It provides multiple quality presets and optimization options to balance file size with visual quality.

## Required TodoWrite Items

```
- Validate input video file exists
- Check ffmpeg installation
- Execute GIF conversion
- Verify output and report results
```
**Verification:** Run the command with `--help` flag to verify availability.

## Process

### Step 1: Validate Input File

Confirm the source video file exists and is a supported format:

```bash
# Check file exists and get info
if [[ -f "$INPUT_FILE" ]]; then
    file "$INPUT_FILE"
    ffprobe -v quiet -show_format -show_streams "$INPUT_FILE" 2>/dev/null | head -20
else
    echo "Error: Input file not found: $INPUT_FILE"
    exit 1
fi
```
**Verification:** Run the command with `--help` flag to verify availability.

Supported input formats: `.webm`, `.mp4`, `.mov`, `.avi`

### Step 2: Check ffmpeg Installation

Verify ffmpeg is available:

```bash
if ! command -v ffmpeg &> /dev/null; then
    echo "Error: ffmpeg is not installed"
    echo "Install with: sudo apt install ffmpeg (Linux) or brew install ffmpeg (macOS)"
    exit 1
fi
ffmpeg -version | head -1
```
**Verification:** Run the command with `--help` flag to verify availability.

### Step 3: Execute Conversion

Choose the appropriate conversion command based on quality requirements:

#### Basic Conversion (Fast, Larger File)

```bash
ffmpeg -i input.webm -vf "fps=10,scale=800:-1" output.gif
```
**Verification:** Run the command with `--help` flag to verify availability.

#### High Quality with Palette Generation (Recommended)

```bash
ffmpeg -i input.webm -vf "fps=10,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" output.gif
```
**Verification:** Run the command with `--help` flag to verify availability.

#### Maximum Quality with Dithering

```bash
ffmpeg -i input.webm -vf "fps=15,scale=1024:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=single[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" output.gif
```
**Verification:** Run the command with `--help` flag to verify availability.

### Optimization Options

| Option | Description | Recommended Value |
|--------|-------------|-------------------|
| `fps` | Frames per second | 10-15 for smooth, 5-8 for smaller files |
| `scale` | Width in pixels (-1 maintains aspect ratio) | 800 for web, 480 for thumbnails |
| `flags=lanczos` | High-quality scaling algorithm | Always use for best quality |
| `palettegen` | Generate optimized color palette | Use for quality-critical output |
| `dither` | Dithering algorithm | `bayer` for patterns, `floyd_steinberg` for smooth |

### Common Presets

```bash
# Thumbnail (small, fast loading)
ffmpeg -i input.webm -vf "fps=8,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" thumbnail.gif

# Documentation (balanced)
ffmpeg -i input.webm -vf "fps=10,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" docs.gif

# High-fidelity demo
ffmpeg -i input.webm -vf "fps=15,scale=1024:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse" demo.gif
```
**Verification:** Run the command with `--help` flag to verify availability.

### Step 4: Verify Output

Confirm successful conversion and report metrics:

```bash
if [[ -f "$OUTPUT_FILE" ]]; then
    echo "GIF generated successfully: $OUTPUT_FILE"

    # Report file size
    SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
    echo "File size: $SIZE"

    # Get dimensions and frame count
    ffprobe -v quiet -select_streams v:0 -show_entries stream=width,height,nb_frames -of csv=p=0 "$OUTPUT_FILE"
else
    echo "Error: GIF generation failed"
    exit 1
fi
```
**Verification:** Run the command with `--help` flag to verify availability.

## Exit Criteria

- [ ] Input file validated as existing video format
- [ ] ffmpeg confirmed available
- [ ] GIF file created at specified output path
- [ ] Output file size reported to user
- [ ] No ffmpeg errors during conversion

## Troubleshooting

### Large Output File

Reduce quality settings:
```bash
# Lower fps and resolution
ffmpeg -i input.webm -vf "fps=8,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" smaller.gif
```
**Verification:** Run the command with `--help` flag to verify availability.

### Color Banding

Use dithering:
```bash
ffmpeg -i input.webm -vf "fps=10,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=dither=floyd_steinberg" smooth.gif
```
**Verification:** Run the command with `--help` flag to verify availability.

### Slow Conversion

Use basic conversion without palette generation for speed:
```bash
ffmpeg -i input.webm -vf "fps=10,scale=800:-1" quick.gif
```
**Verification:** Run the command with `--help` flag to verify availability.
