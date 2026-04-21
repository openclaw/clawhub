# Logo Replacement Design

Date: 2026-04-21
Topic: Comprehensive logo replacement using the provided lobster artwork

## Summary

Replace every current application logo surface with the user-provided lobster artwork while preserving the existing UI layout and copy. This includes in-app logo images, favicon and install icon assets, and manifest/head wiring. The existing wide social preview image `public/og.png` remains unchanged. Instead, `public/og-logo.png` is included in the replacement asset pack as a standalone logo export and is not wired into site metadata.

## Goals

- Replace all current logo imagery with the provided lobster art.
- Preserve existing layout structure in header, mobile navigation, and hero content.
- Provide dedicated asset files for browser, install, and app surfaces rather than relying on one large source image everywhere.
- Keep runtime references stable where possible by replacing existing filenames in place.
- Improve browser/device logo behavior by adding standard favicon and touch icon variants.

## Non-Goals

- No header, navigation, or hero layout redesign.
- No typography or copy changes to the `ClawHub` wordmark text.
- No change to the existing social preview card asset `public/og.png`.
- No full vector redraw of the lobster artwork from scratch.

## Scope

### In Scope

- Replace:
  - `public/clawd-logo.png`
  - `public/clawd-mark.png`
  - `public/logo192.png`
  - `public/logo512.png`
  - `public/favicon.ico`
- Add or update:
  - `public/favicon-16x16.png`
  - `public/favicon-32x32.png`
  - `public/apple-touch-icon.png`
  - `public/logo.jpg`
  - `public/logo.svg`
  - `public/og-logo.png`
- Update runtime/browser metadata:
  - root document link tags in `src/routes/__root.tsx`
  - `public/manifest.json`

### Out of Scope

- `public/og.png`
- Any route-level social metadata currently using `og.png`
- Any non-logo artwork or unrelated illustration assets

## Current State

- The app currently references `public/clawd-logo.png` in the desktop and mobile header.
- The homepage hero references `public/clawd-mark.png`.
- The root document exposes `/favicon.ico`, `/logo192.png`, and `/manifest.json`.
- The web app manifest references `favicon.ico`, `logo192.png`, and `logo512.png`.
- The site-wide OG metadata still references `og.png`.

## Recommended Approach

Use the provided lobster image as the master artwork and derive a small asset pack tailored to each output surface.

Why this approach:

- It satisfies the request to replace the logo everywhere it appears.
- It avoids visual degradation from blindly reusing one oversized raster in tiny favicon contexts.
- It minimizes application code changes by preserving the established filenames used by the UI.

## Asset Plan

### Master Asset

Create one high-resolution square source derived from the attached lobster artwork. This will be the basis for all exported formats.

### Replacement Assets

- `clawd-logo.png`
  - High-resolution square PNG used by header/mobile brand image references.
- `clawd-mark.png`
  - High-resolution square PNG used by hero/logo-only surfaces.
- `logo192.png`
  - 192×192 install icon.
- `logo512.png`
  - 512×512 install icon.
- `favicon.ico`
  - Multi-size favicon generated from the same master for browser tab use.
- `favicon-16x16.png`
  - Explicit raster favicon for browsers that prefer PNG.
- `favicon-32x32.png`
  - Explicit raster favicon for higher-density tab/bookmark use.
- `apple-touch-icon.png`
  - 180×180 touch icon for iOS home screen usage.
- `logo.jpg`
  - Flattened JPEG export for contexts where a non-transparent logo file is useful.
- `logo.svg`
  - SVG wrapper asset that embeds the logo image in an SVG container so an SVG logo file exists for downstream usage without falsely claiming the art is natively vector.
- `og-logo.png`
  - Logo-focused branded raster asset retained separately from the existing wide social card `og.png`.

## Runtime Wiring

### Application UI

- Keep existing JSX references to `clawd-logo.png` and `clawd-mark.png` unless a clearer dedicated asset path becomes necessary.
- Do not replace image elements with text or SVG components.

### Root Head Tags

Update `src/routes/__root.tsx` to use dedicated icon assets:

- `rel="icon"` should include PNG favicon variants in addition to the ICO.
- `rel="apple-touch-icon"` should point to `apple-touch-icon.png`.
- `rel="manifest"` remains `manifest.json`.
- OG/Twitter metadata remains wired to `og.png` and is not changed.

### Web App Manifest

Update `public/manifest.json` so install surfaces reference the replacement icon assets. Keep the manifest conservative and omit maskable-specific `purpose` values for this change.

## Data Flow

1. Start from the provided lobster artwork.
2. Export optimized raster variants for each target size.
3. Replace or add files in `public/`.
4. Update root document links and manifest entries.
5. Build the app and verify the logo surfaces still render without layout regressions.

## Error Handling And Risks

### Small-Size Legibility

Risk: the artwork is detailed and may lose clarity at favicon sizes.

Mitigation:

- Generate dedicated 16×16 and 32×32 outputs instead of relying only on browser downscaling.
- Prefer the ICO plus PNG favicon set to maximize compatibility.

### Raster-As-Vector Expectations

Risk: a pure SVG redraw would be time-consuming and subjective.

Mitigation:

- Provide `logo.svg` as an SVG container asset, while using raster files for browser/runtime surfaces that need visual fidelity.

### Unintended Social Preview Changes

Risk: a broad asset refresh accidentally changes OG behavior.

Mitigation:

- Explicitly leave `og.png` and its metadata references untouched.
- Treat `og-logo.png` as a separate logo asset only.

## Testing And Verification

- Confirm the generated files exist in `public/` with expected dimensions.
- Run the production build to ensure asset references still resolve.
- Spot-check the following surfaces:
  - desktop header brand image
  - mobile navigation brand image
  - homepage hero lobster image
  - browser favicon and touch icon wiring
  - manifest icon references
- Verify that `og.png` remains unchanged and the site metadata still references it.

## Implementation Notes

- Use minimal code churn: replace files in place where existing paths are already correct.
- Add new icon files only where they improve browser/device handling.
- Keep the change tightly scoped to branding assets and metadata.

## Acceptance Criteria

- Every current application logo surface displays the provided lobster artwork instead of the previous brand image.
- Favicon, touch icon, and install icons resolve to replacement assets.
- Header/mobile/hero layout remains unchanged.
- `og.png` is not modified.
- `og-logo.png` exists as part of the updated asset pack.
- The app builds successfully after the change.
