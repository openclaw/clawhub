# Application Surfaces

Carapace provides framework-neutral anatomy for compact application shells,
panes, settings, model controls, and focused utility windows. Consumers keep
routing, data, persistence, window management, and interaction behavior.

## Shared Contract

Import the candidate application layer after the stable component and candidate
control entry points:

```css
@import "@openclaw/carapace/components.css";
@import "@openclaw/carapace/themes/product.css";
@import "@openclaw/carapace/candidate/controls.css";
@import "@openclaw/carapace/candidate/feedback.css";
@import "@openclaw/carapace/candidate/application.css";
```

Compose the contract from these roles:

- `.oc-app-frame` separates primary navigation from collection and operations
  screens that genuinely need global navigation.
- `.oc-app-content` contains the route-owned surface below global chrome.
- `.oc-page-header` names the current route and holds route-level actions when
  the route needs an introduction.
- `.oc-pane` provides bounded header, body, and footer regions.
- `.oc-master-detail`, `.oc-master-pane`, `.oc-detail-pane`,
  `.oc-app-resource-list`, and `.oc-activity-list` support repeated operational
  inspection without turning every datum into a card.
- `.oc-settings-shell`, `.oc-settings-navigation`, `.oc-settings-detail`, and
  `.oc-detail-header` create a settings takeover with local navigation and a
  focused detail canvas.
- `.oc-settings-section`, `.oc-settings-group`, and `.oc-settings-row` create
  dense, scan-friendly preference screens.
- `.oc-chat-shell`, `.oc-workspace-grid`, `.oc-workspace-sessions`,
  `.oc-workspace-conversation`, and `.oc-workspace-inspector` create a
  session-oriented working surface without duplicating the global app shell.
- `.oc-model-controls`, `.oc-model-picker`, `.oc-model-menu`, and
  `.oc-model-speed-toggle` keep model, provider, reasoning, and speed controls
  beside the composer.
- `.oc-session-toolbar`, `.oc-session-table`, and `.oc-session-cell` support
  dense session management.
- `.oc-quick-chat` composes captured context, response state, and the shared
  model controls into a focused utility surface.
- `.oc-status` presents compact operational state with text and a semantic
  indicator.
- `.oc-summary-strip` and `.oc-summary-metric` lead a collection with stable
  key metrics; `.oc-session-badges`, `.oc-owner-chip`, `.oc-unread-dot`, and
  `.oc-run-spinner` carry row-scale signals.
- `.oc-split`, `.oc-split-pane`, `.oc-panel-tab-strip`, and
  `.oc-split-divider` compose docked two-pane work surfaces; resize behavior
  stays consumer-owned.
- `.oc-log-stream` renders dense diagnostic rows with level, time,
  subsystem, and message columns.
- `.oc-menu-panel` structures the tray or menu-bar dropdown: identity,
  usage meters, session shortcuts, and footer actions.
- `.oc-option-card` renders setup choices as real radio labels;
  `.oc-connect` is the shared pairing and sign-in surface.
- `.oc-command-palette` provides the shared command dialog anatomy.
- `.oc-hovercard` and `.oc-lightbox` cover anchored reference context and
  single-attachment inspection.
- `.oc-table-toolbar`, `.oc-table-bulk-bar`, `.oc-table-sort`, and
  `.oc-table-footer` (candidate data layer) extend collection tables with
  search, selection, sorting, and pagination chrome.

The agent entry point (`candidate/agent.css`) owns approval prompts
(`.oc-approval-card`, `.oc-approval-queue`) and transcript anatomy:
`.oc-tool-kv`, `.oc-json-collapse`, `.oc-work-group`, `.oc-turn-recap`,
`.oc-compaction`, and `.oc-activity-indicator`. Approval policy, transport,
and expansion behavior stay consumer-owned.

Use existing controls such as `.oc-switch`, `.oc-input`, `.oc-select`,
`.oc-segmented`, `.oc-action`, and `.oc-badge` inside these compositions. Do not
create application-specific replacements for controls already in Carapace.

## Composition Rules

- Use global navigation only for route collections. Settings and chat are
  takeover surfaces and should not carry a second redundant shell.
- Local rails answer what is selected inside a route. Do not merge global and
  local navigation into one undifferentiated sidebar.
- Put route-specific filters and actions beside the route title or collection
  they affect. Do not add a persistent toolbar without a repeated global job.
- Prefer immediate list and detail anatomy over summary KPI slabs. Put health,
  history, and explanations in the selected detail surface.
- Give master lists identity, status, and one useful comparison value. Keep
  editing controls in the selected detail pane.
- Let the primary task own most of a workspace. Session history and inspectors
  should stay narrower, hide on constrained widths, and never squeeze the
  primary content below a usable measure.
- Set `data-inspector="true|false"` on `.oc-chat-shell` for workspace layouts.
  Add `data-dock="right|bottom|hidden"` when inspector placement changes;
  bottom layout is reserved only while an inspector is present.
- Keep model selection, reasoning, speed, attachment, and send controls in one
  compact composer toolbar. Provider grouping and recent models belong inside
  the picker rather than in a separate settings flow.
- Use bounded groups for related settings, not a card around every row or
  section. Keep settings navigation visually quieter than the selected detail.
- Keep common navigation and collection rows near 32px and settings rows near
  48px. Increase height only when content or platform accessibility requires
  it.
- Limit motion to disclosure, utility-window entry, progress, and streaming
  state. Keep transitions between 140ms and 220ms and disable them under
  `prefers-reduced-motion`.
- Use coral for primary action and selection, sea for connected identity and
  secondary context, and status roles for outcomes. Do not recolor neutral
  structure for decoration.

## Consumer Boundary

The macOS app should map this anatomy onto native SwiftUI and AppKit structures.
It keeps native materials, title bars, window sizing, sheets, toolbar behavior,
keyboard commands, and platform accessibility semantics.

The Control UI should compose the CSS classes inside its existing Lit views. It
keeps route state, WebSocket lifecycle, data loading, local persistence,
responsive navigation behavior, and docked-panel interaction.

Both consumers may adapt density and placement to their platform. They should
preserve the same hierarchy, control roles, semantic status, and responsive
intent rather than reproduce identical pixels.

## Promotion Evidence

The candidate contract is based on repeated structures in two consumers:

- macOS settings, Quick Chat, model selection, and dashboard panes
- Control UI settings, sessions, sidebar navigation, chat model controls, route
  headers, and docked panels

Keep the entry point opt-in until both consumers have adopted and validated the
same anatomy. Promote only after browser and native-app evidence shows that the
selectors remain useful without consumer-specific exceptions.

## Validation

- Verify desktop, tablet, and narrow layouts.
- Verify light and dark themes.
- Verify expanded and compact global navigation on routes that use it.
- Verify settings navigation, master-detail, inspector-right,
  inspector-bottom, and inspector-hidden layouts.
- Verify model picker open and closed states, every supported model, reasoning
  levels, fast mode, and locked state.
- Verify Sessions ready, loading, empty, running, idle, and failed states.
- Verify Quick Chat idle and active states with captured context.
- Check keyboard focus and accessible names for every interactive control.
- Check reduced-motion behavior for picker, progress, streaming, and utility
  window entry.
- Keep status understandable without color alone.
- Confirm that long labels and descriptions wrap without resizing fixed UI.
- Confirm that native platform behavior remains native after visual alignment.
