# Video Capture Module

Video format options, quality settings, and post-processing for Playwright recordings.

## Video Format

Playwright records video in **WebM** format with VP8 codec. This format:
- Has good compression
- Supports transparency (if needed)
- Works well with ffmpeg for conversion
- Is natively supported by most browsers

## Resolution Settings

### Common Resolutions

| Resolution | Use Case | Aspect Ratio |
|------------|----------|--------------|
| 1920x1080 | Full HD, detailed demos | 16:9 |
| 1280x720 | Standard tutorials | 16:9 |
| 1024x768 | Compact demos | 4:3 |
| 800x600 | Small GIF output | 4:3 |

### Playwright Video Size Configuration

```typescript
// In playwright.config.ts
use: {
  video: {
    mode: 'on',
    size: { width: 1280, height: 720 }
  },
  viewport: { width: 1280, height: 720 }
}
```

**Important:** Match `video.size` to `viewport` for best quality.

### Per-Test Video Settings

```typescript
import { test } from '@playwright/test';

test.use({
  video: {
    mode: 'on',
    size: { width: 1920, height: 1080 }
  },
  viewport: { width: 1920, height: 1080 }
});

test('high-res demo', async ({ page }) => {
  // Test runs at 1080p
});
```

## Quality Considerations

### Frame Rate

Playwright records at approximately 25 fps. This is sufficient for UI demos.

### Bitrate

WebM videos from Playwright use variable bitrate. Typical sizes:
- 720p, 30 seconds: 2-5 MB
- 1080p, 30 seconds: 5-10 MB

### Minimizing File Size

1. **Smaller viewport** - Reduce dimensions
2. **Shorter duration** - Trim unnecessary pauses
3. **Simple animations** - Fewer visual changes = smaller file

## Playwright Video Configuration in Tests

### Enable Video for Specific Tests

```typescript
import { test } from '@playwright/test';

// Enable video for this test file
test.describe.configure({ mode: 'serial' });

test.use({
  video: 'on',
  viewport: { width: 1280, height: 720 }
});

test('recorded demo', async ({ page }) => {
  await page.goto('https://example.com');
  await page.waitForTimeout(1000);
});
```

### Conditional Recording

```typescript
import { test } from '@playwright/test';

const RECORD = process.env.RECORD === 'true';

test.use({
  video: RECORD ? 'on' : 'off'
});

test('conditionally recorded', async ({ page }) => {
  // Only records when RECORD=true
});
```

### Custom Video Directory

```typescript
import { test } from '@playwright/test';

test.use({
  contextOptions: {
    recordVideo: {
      dir: './custom-video-output',
      size: { width: 1280, height: 720 }
    }
  }
});
```

## Post-Processing with ffmpeg

### Convert WebM to MP4

```bash
ffmpeg -i video.webm -c:v libx264 -crf 23 output.mp4
```

### Extract Specific Time Range

```bash
# Extract from 0:05 to 0:15
ffmpeg -i video.webm -ss 00:00:05 -to 00:00:15 -c copy trimmed.webm
```

### Change Resolution

```bash
# Scale to 800px width, maintain aspect ratio
ffmpeg -i video.webm -vf "scale=800:-1" scaled.webm
```

### Speed Up Video

```bash
# 2x speed
ffmpeg -i video.webm -filter:v "setpts=0.5*PTS" faster.webm
```

### Add Padding/Borders

```bash
# Add 10px black border
ffmpeg -i video.webm -vf "pad=width+20:height+20:10:10:black" padded.webm
```

### Combine Multiple Videos

```bash
# Create file list
echo "file 'video1.webm'" > list.txt
echo "file 'video2.webm'" >> list.txt

# Concatenate
ffmpeg -f concat -safe 0 -i list.txt -c copy combined.webm
```

## Converting to GIF

For GIF conversion, use the `scry:gif-generation` skill which handles:
- Palette generation for optimal colors
- Frame rate reduction (10-15 fps typical)
- Width scaling
- Dithering for quality

Quick ffmpeg conversion (basic):

```bash
# Simple conversion (larger file, lower quality)
ffmpeg -i video.webm -vf "fps=10,scale=800:-1" output.gif

# Better quality with palette
ffmpeg -i video.webm -vf "fps=10,scale=800:-1,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" output.gif
```

## Troubleshooting

### Video is black or frozen

- validate page has visible content before recording starts
- Add `await page.waitForLoadState('domcontentloaded')`
- Check for CSS that hides content initially

### Video cuts off early

- Test might be finishing before video flushes
- Add `await page.waitForTimeout(500)` at end of test
- validate `await page.close()` is not called (Playwright handles cleanup)

### Video too large

- Reduce resolution
- Shorten test duration
- Use post-processing to compress

### Choppy playback

- Normal at high resolutions
- Consider reducing to 720p
- Final GIF will be smoother at lower fps
