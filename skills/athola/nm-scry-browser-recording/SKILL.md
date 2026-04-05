---
name: browser-recording
description: Record browser sessions using Playwright for web UI tutorials, converts
version: 1.8.1
triggers:
  - playwright
  - browser
  - recording
  - video
  - web
  - tutorial
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/scry", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.scry:gif-generation"]}}}
source: claude-night-market
source_plugin: scry
---

> **Night Market Skill** — ported from [claude-night-market/scry](https://github.com/athola/claude-night-market/tree/master/plugins/scry). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [Required TodoWrite Items](#required-todowrite-items)
- [Process](#process)
- [Step 1: Validate Playwright Installation](#step-1:-validate-playwright-installation)
- [Step 2: Check Spec File](#step-2:-check-spec-file)
- [Step 3: Execute Recording](#step-3:-execute-recording)
- [Step 4: Convert to GIF](#step-4:-convert-to-gif)
- [Example Playwright Spec](#example-playwright-spec)
- [Playwright Configuration](#playwright-configuration)
- [Exit Criteria](#exit-criteria)
- [Error Handling](#error-handling)
- [Output Locations](#output-locations)
- [See Also](#see-also)


# Browser Recording Skill

Record browser sessions using Playwright to create video captures of web UI interactions for tutorials and documentation.


## When To Use

- Recording browser sessions with Playwright
- Creating web application demo recordings

## When NOT To Use

- Terminal-only workflows - use scry:vhs-recording instead
- Static screenshots - use standard screenshot tools

## Overview

This skill uses Playwright's built-in video recording to capture browser interactions. The workflow:

1. Validate Playwright installation
2. Execute a Playwright spec with video recording enabled
3. Retrieve the recorded video (WebM format)
4. Convert to GIF using the gif-generation skill

> **💡 Note**: Claude Code 2.0.72+ includes native Chrome integration for interactive browser control. This skill (Playwright) is designed for **automated recording workflows, CI/CD, and cross-browser support**. For interactive debugging and live testing, consider using native Chrome integration. Both approaches complement each other - develop interactively with Chrome, then automate with Playwright specs.

## Required TodoWrite Items

When invoking this skill, create todos for:

```
- [ ] Validate Playwright is installed and configured
- [ ] Check spec file exists at specified path
- [ ] Execute Playwright spec with video recording
- [ ] Locate and verify video output
- [ ] Convert video to GIF using gif-generation skill
```
**Verification:** Run the command with `--help` flag to verify availability.

## Process

### Step 1: Validate Playwright Installation

Check that Playwright is available:

```bash
npx playwright --version
```
**Verification:** Run the command with `--help` flag to verify availability.

If not installed, the user should run:
```bash
npm install -D @playwright/test
npx playwright install chromium
```
**Verification:** Run `pytest -v` to verify tests pass.

### Step 2: Check Spec File

Verify the Playwright spec file exists. Spec files should:
- Be located in a `specs/` or `tests/` directory
- Have `.spec.ts` or `.spec.js` extension
- Include video configuration (see spec-execution module)

### Step 3: Execute Recording

Run the spec with video enabled:

```bash
npx playwright test <spec-file> --config=playwright.config.ts
```
**Verification:** Run `pytest -v` to verify tests pass.

The config must enable video recording. See the spec-execution module for configuration details.

### Step 4: Convert to GIF

After recording completes, use the gif-generation skill to convert the WebM video to an optimized GIF:

```
**Verification:** Run the command with `--help` flag to verify availability.
Invoke scry:gif-generation with:
- input: <path-to-webm>
- output: <desired-gif-path>
- fps: 10 (recommended for tutorials)
- width: 800 (adjust based on content)
```
**Verification:** Run the command with `--help` flag to verify availability.

## Example Playwright Spec

```typescript
import { test, expect } from '@playwright/test';

test('demo workflow', async ({ page }) => {
  // Navigate to the application
  await page.goto('http://localhost:3000');

  // Wait for page to be ready
  await page.waitForLoadState('networkidle');

  // Perform demo actions
  await page.click('button[data-testid="start"]');
  await page.waitForTimeout(500); // Allow animation to complete

  await page.fill('input[name="query"]', 'example search');
  await page.waitForTimeout(300);

  await page.click('button[type="submit"]');
  await page.waitForSelector('.results');

  // Final pause to show results
  await page.waitForTimeout(1000);
});
```
**Verification:** Run `pytest -v` to verify tests pass.

## Playwright Configuration

Create or update `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    video: {
      mode: 'on',
      size: { width: 1280, height: 720 }
    },
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      slowMo: 100 // Slow down actions for visibility
    }
  },
  outputDir: './test-results',
});
```
**Verification:** Run `pytest -v` to verify tests pass.

## Exit Criteria

- Playwright spec executed successfully (exit code 0)
- Video file exists in output directory
- Video has non-zero file size
- GIF conversion completed (if requested)

## Error Handling

| Error | Resolution |
|-------|------------|
| Playwright not installed | Run `npm install -D @playwright/test` |
| Browser not installed | Run `npx playwright install chromium` |
| Spec file not found | Verify path and file extension |
| Video not created | Check Playwright config has video enabled |
| Empty video file | validate spec actions complete before test ends |

## Output Locations

Default output paths:
- Videos: `./test-results/<test-name>/video.webm`
- Screenshots: `./test-results/<test-name>/screenshot.png`

## Module Reference

- See `modules/spec-execution.md` for detailed Playwright execution options
- See `modules/video-capture.md` for video format and quality settings

## See Also

- scry:gif-generation: Convert video to optimized GIF
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
