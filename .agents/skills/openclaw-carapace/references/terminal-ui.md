# Terminal UI

Carapace documents terminal translations of its existing design language. The
terminal consumer keeps runtime behavior, ANSI rendering, keybindings,
commands, session state, and framework adapters.

Browser specimens use the runtime as their source of truth. Run the real
OpenClaw Pi or Clack component in a fixed-size PTY, capture its output bytes
with `@openclaw/libterminal`, and replay those bytes through libterminal's
Ghostty WASM renderer. Use HTML only for documentation around the terminal.
Never redraw a terminal specimen with HTML elements or browser controls.

The current reference covers both OpenClaw terminal compositions:

- the retained agent TUI on `@earendil-works/pi-tui@0.81.1`
- onboarding and command setup on `@clack/prompts@1.7.0`

Re-audit OpenClaw, Pi, and Clack before treating version-specific behavior as
current.

## Reuse first

Use existing Carapace Colors, Typography, Layout, Motion, Base styles, inputs,
selections, approvals, loaders, flows, and Agent Components. Terminal UI adds
only terminal-specific constraints: ANSI and cell width, the host foreground
and font, focus and cursor ownership, scrollback/history, and row/column limits.

Do not create a TUI palette, typography scale, CSS export, component package, or
second renderer.

## Structure

Model the agent TUI as one vertical conversation buffer:

1. header identity
2. transcript rows and work cards
3. connection and activity status
4. session footer
5. focused editor

Pickers, settings, consent, approvals, and task suggestions are transient
focus-capturing overlays. Help, command feedback, local-shell output, and most
errors return to the transcript; do not present them as separate screens.

Model setup as one append-only guide with a single active prompt. Completed
ordinary answers collapse into history; notes and progress preserve context;
intro, outro, and cancellation visibly close the guide.

## Visual roles

- Preserve assistant prose in the terminal's default foreground.
- Use a neutral inset surface for user-authored turns.
- Keep system notices muted and inline.
- Use primary accent for the active choice or explicit confirmation.
- Use secondary accent for focus, connection, and current context.
- Reserve success, warning, and error colors for outcomes.
- Pair every colored state with text, a glyph, ordering, or another non-color
  signal.
- Do not infer severity colors when the consumer currently renders severity as
  text metadata.

Carapace's browser specimens may map these relationships to coral, sea, and
semantic status roles. That mapping is documentation, not an exported ANSI
theme API.

## Reference tokens

The Terminal UI Lab keeps a small reference token map for relationships shared
by the audited Clack and Pi surfaces. It is design guidance and preview input,
not a published component or token package.

- Terminal color roles alias the existing Carapace background, text, accent,
  status, and monospace-font variables. Do not add terminal-only colors.
- `terminal.space.marker-label` is the one-cell gap between a marker and label.
- `terminal.space.leading-prefix` is the two-cell guide, focus, or selection
  prefix before content.
- `terminal.viewport.compact` is 40 columns.
- `terminal.viewport.standard` is 80 columns.
- `terminal.viewport.reference` is 120 columns and drives canonical captures.

The viewport values are validation profiles, not component dimensions. A
terminal implementation must still fit the column count supplied by its
runtime.

## Cells and width

- Design and test in terminal columns and rows, not browser pixels.
- Ensure every rendered line fits its supplied width after ANSI sequences are
  ignored.
- Preserve grapheme clusters, ANSI styles, and OSC 8 links when wrapping or
  truncating.
- Remove optional descriptions before labels, selection prefixes, or actions.
- Bound long output and name omitted content; expansion behavior stays in the
  consumer.
- Treat consumer-specific line, item, and output limits as audited facts, not
  Terminal UI tokens.

## Setup prompts

- Keep text, sensitive text, select, multiselect, searchable variants, confirm,
  and progress within one connected guide.
- Keep validation next to the active value or list.
- Mask sensitive input, omit it from submitted history, and never cache it for
  replay.
- Preserve the focused option when clipping long lists. Remove descriptions
  before labels, selection markers, or actions.
- Keep option anatomy explicit: marker, human label, stable value, annotation,
  optional description, and availability reason. `current`, `default`,
  `selected`, `recommended`, and `configured` are separate meanings; do not
  collapse them into one state.
- At wide widths, concise metadata may follow the label. At narrow widths, move
  metadata to a second line and remove optional description before identity or
  status.
- Show Back and Next only when available. Next accepts a remembered answer
  without replaying output or side effects.
- Disable Back after irreversible work instead of rerunning unsafe steps.
- Use notes for framed human context and plain output for raw disclosure.

## Input and decisions

- The focused surface owns Enter, Escape, arrows, paging, and confirmation.
- Propagate focus to embedded text inputs so hardware-cursor and IME placement
  remain correct.
- Keep a conservative action selected first when one is available.
- Require an explicit second commit for privileged or costly actions.
- Changing selection disarms confirmation.
- Name the consequence in the confirmation sentence.
- Preserve visible stale, expired, denied, accepted, dismissed, and failed
  outcomes.
- Keep one active decision at a time even when the runtime can stack overlays.

Simple setup confirmation can render inline or vertically. Detailed agent
approvals may use overlays and an explicit arm-then-commit sequence. Label
specimens by renderer instead of implying that Pi and Clack are one component
implementation.

## Approvals

Treat an approval as a bounded authorization surface, not a verbose
confirmation. Show the approval family and requested action first, then
severity, owner metadata, request context, the allowed decision set, and the
eventual outcome.

- Render only decisions supplied by the request. Never invent persistent
  authorization when `allow-always` is unavailable.
- Focus Deny first whenever it is available. Escape resolves Deny in that
  case; an allow-only prompt dismisses without authorizing and remains pending.
- `Allow once` authorizes the current request. `Always allow` authorizes only
  the matching future scope defined by the owner and must name that persistence
  clearly.
- Require a visible second commit when an allow action starts focused. Moving
  to another decision clears the armed state.
- Sanitize untrusted title, description, tool, and plugin text before terminal
  rendering. Preserve bidi, ANSI, OSC, and control-sequence defenses.
- Return allowed, denied, dismissed, expired, stale, and failed outcomes to the
  transcript. Do not silently close the overlay or imply that dismissal denied
  an allow-only request.
- Queue one session-matching request at a time. Resolution from another client
  closes the local overlay and records that the request is no longer pending.

## Ownership

Use the existing terminal runtime. Do not introduce a second renderer, copy its
width or focus algorithms into Carapace, import browser CSS into an ANSI
surface, or publish a terminal component API from one consumer's implementation.

Markup sections may show Carapace's standalone copy-and-paste libterminal
replay interface. They must not present local Pi classes, WizardPrompter calls,
or partial Clack excerpts as reusable Carapace components. Link those audited
OpenClaw sources as implementation evidence instead.

Keep the Carapace Terminal UI area in Lab until a second terminal consumer
proves a shared reusable interface. Cross-link existing Carapace pages for
medium-neutral semantics; Terminal UI owns only the translation into cells,
terminal focus, ANSI, scrollback/history, and terminal compositions.

## Validation

- Verify comfortable, narrow, and short terminal sizes with real PTY proof.
- Verify light and dark theme relationships.
- Verify idle, streaming, tool success/error, approval, task suggestion, and
  picker states.
- Verify onboarding intro/outro/cancel, ordinary and sensitive fields,
  validation, select/multiselect/searchable variants, inline/vertical confirm,
  progress, remembered answers, replay suppression, and irreversible
  boundaries.
- Verify Enter and Escape precedence across editor, inline result, active run,
  filter, and overlay scopes.
- Verify state remains understandable without color.
- Regenerate the libterminal fixtures from the audited OpenClaw revision before
  updating a specimen.
- Use browser screenshots to validate Carapace reference pages, not as proof of
  the terminal runtime; the captured PTY bytes are the runtime evidence.
