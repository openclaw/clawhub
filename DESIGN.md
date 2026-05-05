# ClawHub Design System

This document outlines the design rules, patterns, and guidelines for the ClawHub platform to ensure consistency, accessibility, and maintainability across all components.

---

## Color System

### Brand Palette (OpenClaw)

ClawHub uses a strict **3-5 color palette** based on the OpenClaw brand:

| Token           | Light Mode | Dark Mode | Usage                                           |
| --------------- | ---------- | --------- | ----------------------------------------------- |
| `--accent`      | `#dc2626`  | `#dc2626` | Primary actions, interactive elements, emphasis |
| `--accent-deep` | `#b91c1c`  | `#ef4444` | Hover states, secondary emphasis                |
| `--ink`         | `#0a0a0a`  | `#fafafa` | Primary text                                    |
| `--ink-soft`    | `#525252`  | `#a1a1a1` | Secondary text, descriptions                    |
| `--surface`     | `#ffffff`  | `#121212` | Card backgrounds, elevated surfaces             |
| `--bg`          | `#fafafa`  | `#0a0a0a` | Page background                                 |

### Rules

1. **Never exceed 5 colors** without explicit design approval
2. **Never use purple/violet prominently** unless explicitly requested
3. **Always override text color** when changing background color to ensure contrast
4. **Use semantic tokens** (`--accent`, `--ink`, `--surface`) instead of raw colors

---

## Typography

### Font Stack

```css
--font-sans: "Geist", system-ui, sans-serif;
--font-mono: "Geist Mono", monospace;
--font-display: "Geist", system-ui, sans-serif;
```

### Scale

| Token       | Size            | Usage                    |
| ----------- | --------------- | ------------------------ |
| `--fs-xs`   | 0.75rem (12px)  | Labels, badges, metadata |
| `--fs-sm`   | 0.875rem (14px) | Body text, descriptions  |
| `--fs-base` | 1rem (16px)     | Default body text        |
| `--fs-md`   | 1.125rem (18px) | Subheadings              |
| `--fs-lg`   | 1.25rem (20px)  | Section titles           |
| `--fs-xl`   | 1.5rem (24px)   | Page headings            |

### Rules

1. **Maximum 2 font families** per page
2. **Line height 1.4-1.6** for body text (use `leading-relaxed`)
3. **Never use decorative fonts** for body text
4. **Minimum font size: 14px** for readability
5. Use `text-balance` or `text-pretty` for titles

---

## Layout

### Method Priority

Use this hierarchy for layout decisions:

1. **Flexbox** - Default for most layouts
2. **CSS Grid** - Only for complex 2D layouts (cards, galleries)
3. **Never use floats** or absolute positioning unless absolutely necessary

### Spacing Scale

```css
--space-1: 0.25rem /* 4px */ --space-2: 0.5rem /* 8px */ --space-3: 0.75rem /* 12px */
  --space-4: 1rem /* 16px */ --space-5: 1.5rem /* 24px */ --space-6: 2rem /* 32px */;
```

### Grid Patterns

#### Auto-fit Grid (Recommended for Cards)

```css
grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
```

- Automatically adjusts columns based on container width
- Prevents orphan items on partial rows
- Maintains consistent card widths

#### Fixed Grid (When exact columns needed)

```css
/* 3-column at desktop, 2 at tablet, 1 at mobile */
grid-template-columns: repeat(3, minmax(0, 1fr));

@media (max-width: 860px) {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 520px) {
  grid-template-columns: 1fr;
}
```

### Container Widths

| Size    | Max Width               | Usage                   |
| ------- | ----------------------- | ----------------------- |
| Default | `--page-max` (1200px)   | Standard pages          |
| Narrow  | `--page-narrow` (720px) | Reading content, forms  |
| Wide    | Full width              | Dashboards, data tables |

---

## Components

### Cards

```css
.card {
  padding: var(--space-4);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface);
}
```

**Rules:**

- Always use `display: flex; flex-direction: column;` for consistent height
- Add `flex: 1` to content area for equal-height cards in grids
- Include hover state with `border-color` and subtle `box-shadow`

### Buttons

| Variant       | Usage                                 |
| ------------- | ------------------------------------- |
| `primary`     | Main actions (Submit, Save, Download) |
| `secondary`   | Alternative actions                   |
| `ghost`       | Tertiary actions, navigation          |
| `destructive` | Delete, remove, dangerous actions     |

**Rules:**

- Always include visible focus state
- Minimum touch target: 44x44px on mobile
- Include `aria-label` when icon-only

### Form Controls

- Labels above inputs (not inline)
- Error states use `--status-error-fg`
- Focus rings use `--accent` with 0.2 opacity
- Minimum input height: 40px

---

## Responsive Breakpoints

```css
/* Mobile first - base styles for mobile */

@media (min-width: 520px) {
  /* Small tablets, large phones */
}

@media (min-width: 640px) {
  /* Tablets */
}

@media (min-width: 860px) {
  /* Small desktops, landscape tablets */
}

@media (min-width: 1024px) {
  /* Desktops */
}

@media (min-width: 1280px) {
  /* Large desktops */
}
```

### Rules

1. **Mobile-first approach** - Base styles target mobile
2. **Progressive enhancement** - Add complexity as viewport increases
3. **Test intermediate breakpoints** - Avoid jarring layout jumps
4. **Never hide critical content** on mobile

---

## Accessibility

### Color Contrast

- Normal text: Minimum 4.5:1 ratio
- Large text (18px+): Minimum 3:1 ratio
- Interactive elements: Minimum 3:1 ratio

### Focus States

```css
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 2px;
}
```

### Screen Readers

- Use `sr-only` class for visually hidden but accessible text
- Always include `alt` text for images (empty `alt=""` for decorative)
- Use semantic HTML elements (`main`, `nav`, `article`, `section`)
- Proper heading hierarchy (h1 > h2 > h3, no skipping)

### Motion

```css
/* Respect user preference */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Animation

### Timing

```css
--transition-fast: 150ms;
--transition-base: 200ms;
--transition-slow: 300ms;
```

### Easing

- Use `ease` or `ease-out` for most transitions
- Use `ease-in-out` for enter/exit animations
- Never use `linear` except for continuous animations

### Rules

1. **Subtle by default** - Avoid flashy animations
2. **Purpose-driven** - Animation should provide feedback
3. **Respect preferences** - Support `prefers-reduced-motion`
4. **Performance** - Use `transform` and `opacity` only

---

## Icons

### Usage

- Use Lucide icons consistently
- Standard sizes: 14px, 16px, 20px, 24px
- Include `aria-hidden="true"` for decorative icons
- Never use emojis as icons

### Placement

- Left of labels in buttons and navigation
- Right of labels for external links or dropdowns
- Centered when used alone with `aria-label`

---

## Dark Mode

### Implementation

```css
[data-theme="dark"] {
  /* Dark mode overrides */
}
```

### Rules

1. Never use pure white (`#ffffff`) on dark backgrounds
2. Reduce shadow intensity in dark mode
3. Adjust image brightness if needed
4. Test contrast ratios in both modes

---

## Performance

### CSS

1. Use CSS custom properties for theming
2. Avoid deeply nested selectors (max 3 levels)
3. Use `will-change` sparingly
4. Prefer `transform` over `top/left` for animations

### Images

1. Always specify `width` and `height` attributes
2. Use `loading="lazy"` for below-fold images
3. Use appropriate formats (WebP with fallbacks)
4. Include placeholder or skeleton states

---

## Code Style

### CSS Class Naming

```css
/* Component */
.component-name {
}

/* Component modifier */
.component-name.variant {
}

/* Component child */
.component-name-child {
}

/* State */
.component-name.is-active {
}
.component-name[data-state="open"] {
}
```

### File Organization

```
src/
  components/
    ui/           # Primitive components (Button, Input, Card)
    layout/       # Layout components (Container, Header)
  styles.css      # Global styles and design tokens
  lib/
    theme.ts      # Theme utilities
    preferences.ts # User preference management
```

---

## Checklist

Before shipping any UI changes, verify:

- [ ] Color contrast meets WCAG AA standards
- [ ] Focus states are visible
- [ ] Layout works at all breakpoints
- [ ] Animations respect `prefers-reduced-motion`
- [ ] Text is readable at default browser zoom
- [ ] Interactive elements have 44px minimum touch target
- [ ] Semantic HTML is used appropriately
- [ ] Dark mode has been tested
