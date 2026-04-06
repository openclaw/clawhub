# Spec Execution Module

Execute Playwright specs with video recording enabled.

## Playwright Configuration for Video

### Minimal Config

Create `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    video: 'on',
  },
  outputDir: './test-results',
});
```

### Full Recording Config

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',

  use: {
    // Video settings
    video: {
      mode: 'on',           // 'on' | 'off' | 'retain-on-failure' | 'on-first-retry'
      size: {
        width: 1280,
        height: 720
      }
    },

    // Browser settings
    viewport: { width: 1280, height: 720 },
    headless: true,

    // Slow down for visibility in recordings
    launchOptions: {
      slowMo: 100
    },

    // Browser context
    contextOptions: {
      recordVideo: {
        dir: './test-results/videos',
        size: { width: 1280, height: 720 }
      }
    }
  },

  // Disable retries for recording
  retries: 0,

  // Single worker for consistent recording
  workers: 1,
});
```

## Running Specs

### Basic Execution

```bash
npx playwright test specs/demo.spec.ts
```

### With Custom Config

```bash
npx playwright test specs/demo.spec.ts --config=playwright.recording.config.ts
```

### Common Options

```bash
# Run specific test by name
npx playwright test -g "demo workflow"

# Run in headed mode (visible browser)
npx playwright test --headed

# Use specific browser
npx playwright test --project=chromium

# Set timeout
npx playwright test --timeout=60000

# Output verbose logs
npx playwright test --debug
```

## Video Output Paths

Playwright creates videos at:
```
<outputDir>/<test-file-name>-<browser>/<test-name>/video.webm
```

Example:
```
test-results/demo-spec-ts-chromium/demo-workflow/video.webm
```

### Programmatic Video Path

Access video path in test:

```typescript
import { test, expect } from '@playwright/test';

test('demo', async ({ page }, testInfo) => {
  // ... test actions ...

  // After test, attach video path
  const video = page.video();
  if (video) {
    const path = await video.path();
    console.log('Video saved to:', path);
  }
});
```

## Error Handling

### Common Issues

**Browser not installed:**
```bash
npx playwright install chromium
```

**Timeout errors:**
```typescript
// Increase action timeout
await page.click('button', { timeout: 10000 });

// Or set global timeout in config
use: {
  actionTimeout: 10000,
}
```

**Video not created:**
- validate `video: 'on'` in config
- Check test actually runs (not skipped)
- Verify outputDir is writable

**Empty or corrupted video:**
- Add `await page.waitForTimeout(500)` before test ends
- validate page has loaded: `await page.waitForLoadState('networkidle')`

### Exit Code Handling

```bash
npx playwright test specs/demo.spec.ts
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "Recording completed successfully"
  # Find video file
  VIDEO=$(find test-results -name "video.webm" -type f | head -1)
  echo "Video: $VIDEO"
else
  echo "Recording failed with exit code $EXIT_CODE"
  exit $EXIT_CODE
fi
```

## Best Practices for Recording Specs

1. **Use explicit waits** - Avoid flaky recordings
   ```typescript
   await page.waitForSelector('.element');
   await page.waitForLoadState('networkidle');
   ```

2. **Add pauses for visibility** - Give viewers time to see actions
   ```typescript
   await page.waitForTimeout(500);
   ```

3. **Use slowMo** - Slow down all actions
   ```typescript
   launchOptions: { slowMo: 100 }
   ```

4. **Consistent viewport** - Match video size to viewport
   ```typescript
   viewport: { width: 1280, height: 720 },
   video: { size: { width: 1280, height: 720 } }
   ```

5. **Disable retries** - One clean recording
   ```typescript
   retries: 0
   ```
