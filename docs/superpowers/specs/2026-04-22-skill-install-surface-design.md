# Skill Install Surface Design

- Date: 2026-04-22
- Status: Approved for planning
- Scope: skill detail page install UX on ClawHub

## Problem

The skill detail page does not treat installation as a primary action. Plugin pages already surface a direct install command prominently, but skill pages bury install-related information inside a denser metadata block. This is weaker for users who arrive on a skill page intending to install immediately.

There is also no first-class prompt-based install flow for OpenClaw. That is especially awkward for remote sessions and server-side environments where the better user experience is often "copy one prompt into OpenClaw and let it handle the install and setup guidance" rather than manually piecing together commands and requirements.

## Goals

1. Make installation a prominent, above-the-fold action on the skill page.
2. Keep exact install commands visible, copyable, and trustworthy.
3. Add an OpenClaw prompt-based install flow that works through copyable prompts only.
4. Support two prompt scopes:
   - `Install Only`
   - `Install & Setup`
5. Keep the flow explicit enough that users can see what will be copied before they use it.

## Non-Goals

1. No direct handoff, deep link, or automatic execution into OpenClaw.
2. No backend or Convex changes.
3. No plugin detail page redesign in this slice.
4. No attempt to auto-complete setup inside ClawHub itself.
5. No hidden prompt generation that users cannot inspect.

## Final UX Direction

Add a new `Install` section near the top of the skill hero, using a split layout:

1. `Install with OpenClaw`
2. `CLI Commands`

Desktop should render these as two sibling panels inside one install surface. Mobile should stack them vertically with `Install with OpenClaw` first.

This section becomes the primary install surface for the page. Existing runtime requirements, dependency metadata, links, and install specs remain available below as supporting information, not as the primary call-to-action.

## Install With OpenClaw Panel

### Structure

The OpenClaw panel contains:

1. A short explanation that this path is best for remote or guided setup.
2. A `Copy Prompt` action with menu behavior.
3. A prompt option menu with two choices:
   - `Install Only`
   - `Install & Setup`
4. A prompt preview area showing the exact prompt that will be copied.

### Interaction Model

The `Copy Prompt` control should behave like a menu trigger, not a blind copy button.

When opened, it reveals:

1. `Install Only`
   Copies a prompt that tells OpenClaw to install the skill and stop there.
2. `Install & Setup`
   Copies a prompt that tells OpenClaw to install the skill, inspect the skill metadata, and help the user finish setup.

Selecting an option should:

1. Update the prompt preview area.
2. Copy the corresponding prompt to the clipboard.
3. Show clear success or failure feedback.

The preview area should remain visible after selection so the copied text is inspectable.

### Prompt Content Rules

Both prompts should include the concrete skill identity, not vague prose.

Prefer:

- canonical install target: `owner/slug`
- canonical skill page URL
- enough setup context to avoid ambiguous or unsafe follow-up behavior

#### Install Only Prompt

The prompt should instruct OpenClaw to:

1. Install the skill from ClawHub.
2. Keep the action narrowly scoped to that skill.
3. Stop after install rather than making setup changes.

#### Install & Setup Prompt

The prompt should instruct OpenClaw to:

1. Install the skill from ClawHub.
2. Inspect the skill metadata and installation requirements.
3. Help the user finish setup steps such as:
   - required env vars
   - required binaries
   - config files or follow-up instructions
4. Avoid unrelated changes.
5. Ask before making broader environment changes.

This prompt is intentionally "full service" but still constrained. It should guide OpenClaw toward a narrow setup flow rather than a vague "do everything" request.

## CLI Commands Panel

The CLI panel keeps the raw install paths visible and copyable.

It should contain two command blocks:

1. `OpenClaw CLI`
2. `ClawHub CLI`

### OpenClaw CLI Command

Primary format:

```sh
openclaw skills install owner/slug
```

If the canonical owner handle is unavailable, fall back to the best canonical identifier already used by the page route. If no owner-qualified target can be built safely, fall back to the plain slug command rather than fabricating a broken owner path.

### ClawHub CLI Command

Preserve package-manager flexibility rather than hard-coding one package manager.

Expected behavior:

1. Reuse the existing package-manager switching pattern already present on the skill page.
2. Keep `npm` selected by default to preserve the current behavior of that switcher.
3. Keep the copied command fully explicit.

Example variants:

```sh
npx clawhub@latest install slug
pnpm dlx clawhub@latest install slug
bunx clawhub@latest install slug
```

Each command block should have its own copy action.

## Supporting Metadata

The current metadata-driven install details should not disappear. Instead, they should move into a clearly secondary role below the new install surface.

This includes:

1. runtime requirements
2. dependencies
3. install specs declared by the skill
4. relevant links

The user should be able to:

1. install immediately from the hero
2. then scroll into requirements and metadata if they need deeper operational detail

## Information Architecture

The page hierarchy after this change should be:

1. skill header and summary
2. primary install surface
3. security scan and other trust signals
4. supporting metadata panels
5. README, files, comments, versions, compare, owner tools

If the existing hero composition requires rearranging nearby blocks to avoid crowding, favor install clarity over preserving the current exact order.

## Component-Level Design

Recommended component split:

1. `SkillInstallSurface`
   Owns the new install section, layout, copy interactions, and prompt preview state.
2. `SkillPromptMenu` or equivalent local subcomponent
   Owns prompt option selection and menu rendering.
3. `InstallCopyButton`
   Shared copy button behavior for commands and prompts, ideally reusing the plugin page copy feedback pattern.
4. Small pure helpers in `skillDetailUtils.ts`
   Build canonical commands and prompt text.

The existing `SkillInstallCard` should be narrowed to supporting metadata panels only. The new
primary install surface should live in a separate component so prompt generation, copy state, and
hero layout are not tangled with dependency metadata rendering.
The goal is to avoid one oversized component that mixes hero layout, prompt generation, copy
logic, and metadata panels.

## Copy and Content Rules

### OpenClaw Copy

- Label: `Copy Prompt`
- Menu options:
  - `Install Only`
  - `Install & Setup`
- Preview should show exact copied text

### CLI Copy

- Keep labels literal: `Copy`
- Do not hide the actual command behind a tooltip-only surface

### Tone

The UI copy should be direct and operational, not marketing-heavy.

Good:

- `Install with OpenClaw`
- `Copy Prompt`
- `Install & Setup`
- `OpenClaw CLI`
- `ClawHub CLI`

Avoid:

- vague claims about automation
- promise-heavy language
- copy that suggests ClawHub will execute anything on the user's behalf

## Accessibility

The new surface must remain keyboard-usable and screen-reader-legible.

Requirements:

1. The prompt menu trigger is keyboard accessible.
2. Menu items expose clear labels and descriptions.
3. Copy success feedback does not rely on color alone.
4. Command text remains selectable and readable at small widths.
5. Mobile layout stacks cleanly without horizontal clipping.

## Error Handling

### Clipboard Failure

If clipboard write fails:

1. use the existing fallback copy path where available
2. show failure feedback if both copy mechanisms fail

### Missing Metadata

If prompt generation cannot build full setup guidance because some metadata is absent:

1. still allow prompt copy
2. generate the best constrained prompt available
3. do not invent requirements that the page does not know

### Missing Canonical Owner

If the owner-qualified target cannot be built reliably:

1. degrade gracefully to the safest install target available
2. keep copied text accurate
3. do not render misleading `owner/slug` syntax

## Testing

### Unit Tests

Add or update tests for:

1. command builders
2. prompt builders
3. canonical owner fallback behavior
4. copy state transitions if extracted into reusable helpers

### Component Tests

Add or update tests for:

1. the new install surface rendering on skill detail pages
2. prompt menu open and selection behavior
3. prompt preview updates
4. OpenClaw and ClawHub command visibility
5. copy success feedback paths

### Manual Verification

Verify:

1. desktop layout
2. mobile stacking
3. long owner/slug values
4. skill pages with sparse metadata
5. copy behavior in browsers with and without `navigator.clipboard`

## Rollout Notes

This feature should ship as a focused UI slice. Keep scope disciplined:

1. no direct OpenClaw handoff
2. no execution inside ClawHub
3. no broad refactor outside the skill detail install surface unless needed to keep the component boundary clean

## Open Questions Resolved

1. The primary layout is the split install surface, not a single merged box.
2. OpenClaw uses copyable prompts only.
3. The prompt flow supports both `Install Only` and `Install & Setup`.
4. The `Copy Prompt` control reveals those prompt options.
5. Raw CLI commands remain visible underneath the OpenClaw flow.
