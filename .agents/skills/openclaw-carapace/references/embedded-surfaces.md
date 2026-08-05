# Embedded Surfaces

MCP apps render inside a sandboxed iframe owned by an OpenClaw host. The host
publishes theme values through the MCP Apps `hostContext.styles.variables`
field, whose key vocabulary is fixed by the specification. Import
`@openclaw/carapace/candidate/embed.css` for the canonical translation between
that vocabulary and the semantic tokens.

## Ownership Split

| Surface | Owner |
| --- | --- |
| Frame, header, provenance, and lifecycle states | Host |
| Page, surface, text, border, focus, and geometry values | Host tokens |
| Layout, content, and interaction inside the app | App |
| Logo, product name, and one accent | App |

An embedded app inherits structure and spends its own brand only on primary
actions and identity moments. Backgrounds, body text, borders, and focus rings
always resolve from host tokens so every installed app reads as one system.

## Variable Mapping

`.oc-embed-tokens` declares the specification vocabulary from `--oc-*` tokens.

| Specification key | Semantic token |
| --- | --- |
| `--color-background-primary` | `--oc-bg-surface` |
| `--color-background-secondary` | `--oc-bg-page` |
| `--color-background-tertiary` | `--oc-bg-elevated` |
| `--color-text-primary` | `--oc-text-primary` |
| `--color-text-secondary` | `--oc-text-secondary` |
| `--color-text-tertiary` | `--oc-text-muted` |
| `--color-border-primary` | `--oc-border-subtle` |
| `--color-border-secondary` | `--oc-border-strong` |
| `--color-ring-primary` | `--oc-focus-ring` |
| `--color-*-info`, `-danger`, `-success`, `-warning` | `--oc-status-*` |
| `--font-sans`, `--font-mono` | `--oc-font-embed-*` |
| `--font-text-*-size`, `--font-heading-*-size` | `--oc-font-size-*` |
| `--border-radius-md` | `--oc-radius-surface` |
| `--shadow-sm`, `--shadow-md`, `--shadow-lg` | `--oc-shadow-*` |

`--color-border-primary` is the default divider and `--color-border-secondary`
is the emphasis step. Carapace defines two neutral border weights, so this is
deliberately not a strict prominence ladder.

Larger heading roles clamp to `--oc-font-size-3xl`. The product type scale caps
at 2rem so an embedded app cannot out-scale the host chrome around it.

Status colors travel as pairs. Each `--color-text-*` clears AA on its matching
`--color-background-*` over the host's own page and surface values, which the
token contract asserts in both themes. The backgrounds are translucent, so the
guarantee reaches only as far as what sits behind them: an app that paints its
own surface under a status tint owns re-checking that pair.

## Fonts

Send `--oc-font-embed-sans` and `--oc-font-embed-mono` for `--font-sans` and
`--font-mono`. They contain system-resolvable families only. Do not send
`--oc-font-body`: a brand face is not guaranteed to resolve inside a sandbox,
and it fails silently onto an arbitrary system font rather than erroring.

MCP Apps does define a font channel. A host may send `@font-face` or `@import`
CSS through `hostContext.styles.css.fonts`, which the app injects with the SDK
helper. Delivery is not guaranteed, because font loading is gated by policy the
app owns rather than the host: `font-src` allows the sandbox origin, which
serves no fonts, plus the resource domains the app declares — and it is absent
entirely when the app declares no policy, leaving `default-src 'none'` to block
the request.

Use the channel for an app that declares the font origin. Keep the system
stacks as the default for everything else.

## Host Integration

Apply `.oc-embed-tokens` to a probe element, read the computed values, and
publish them as `hostContext.styles.variables`. Keep the class off the document
root when the consumer also imports the Tailwind adapter, which declares
`--font-mono` and `--shadow-*` under the same names.

Republish on every theme change. Continue sending the specification
`hostContext.theme` string; the token payload is additive.

## Branding

`hostContext.styles.variables` is a closed record: its key set is fixed by the
specification and validated at runtime, so a host cannot add an OpenClaw name
to the payload. An app accent is therefore never transported through the style
channel.

Branding lives in two places instead:

- The app owns its accent inside its own document. It already knows its brand
  and needs nothing from the host to render it.
- The frame reserves `--oc-app-accent` and `--oc-app-accent-contrast` as the
  host-side seam for tinting chrome. The pair travels together: an accent the
  host cannot put a legible foreground on is unusable, so a host that
  overrides one overrides both, and validates contrast against the current
  surfaces before applying either.

Where a host reads an app's accent from is not settled. The MCP Apps resource
metadata carries CSP, sandbox permissions, domain, and a border preference,
but no brand color, so nothing in the protocol supplies one today. Until an
OpenClaw contract defines that source, leave host chrome unbranded and let the
slot fall back to the OpenClaw accent rather than inventing a private field.

An app spends its accent on primary actions and identity moments. Backgrounds,
body text, borders, and focus rings stay on host tokens, which is what keeps
every installed app recognizable as one system.

## App Integration

- Bundle `@openclaw/carapace/candidate/embed.css` for defaults, then apply the
  host values at runtime. Host values arrive inline and win.
- Resolve every value through the specification key with a literal fallback so
  the app still renders standalone.
- Key dark mode off `[data-theme]`. A bare `prefers-color-scheme` query tracks
  the operating system, not the host theme, and mismatches inside the frame.
- Apply the host theme with the app SDK helper, which sets `color-scheme`
  alongside `data-theme`. The bundled fallbacks use `light-dark()` and follow
  `color-scheme`; with neither set they resolve to their light values.
- Keep the app's own accent local. Do not restyle host chrome.
- Declare image and media origins in the resource metadata; the sandbox blocks
  undeclared origins.
- Stay within the host's height range and report size changes through the app
  bridge rather than assuming a viewport.

## Sizing

The size contract is the most common source of embedded breakage.

- The host clamps a reported height to a range and applies a default when the
  app reports nothing. OpenClaw clamps to 160–1200px and defaults to 600px.
  Design for the narrow end; do not assume the default.
- The body slot supplies no padding. The app owns its own inset.
- The specification treats a fixed `containerDimensions.height` as host-owned
  sizing, and a `maxHeight` or an omitted field as handing height to the app.
  Where a host honors that split, fill a host-owned height and scroll inside.
- OpenClaw does not honor it. Both of its hosts send a fixed number and still
  resize the frame from the reported height — the standalone host hardcodes
  600 and auto-resizes anyway — so against OpenClaw the field says nothing
  about who owns sizing.
- When the split cannot be trusted, which includes OpenClaw today, let content
  determine height and do not set `height: 100%` on `html` or `body` while
  `autoResize` is on. The app would measure a height the host just set from the
  app's own measurement, and against a host that reports a fixed height and
  still auto-resizes, that pins the app at the reported value forever.
- When the app genuinely needs a scrolling region, give that region its own
  `max-height` and scroll it, rather than making the document fill the frame.
- `containerDimensions` is optional, and each axis independently arrives as a
  fixed value, a maximum, or neither. The maximum branches are themselves
  optional, so an axis with no fields means unbounded, and an absent
  `containerDimensions` means the app knows nothing about its container. Handle
  all three per axis; do not assume one field is always present.
- Report both dimensions and let the host decide what to use. OpenClaw sizes
  only height today and ignores the reported width; a host that sizes width
  from the app has nothing to work from if the app reports height alone.
- Keep any scroll boundary inside the app's own region so the frame's border
  and radius are never crossed by a scrollbar.

## Density and Container Adaptation

The same app renders in a chat card, a fixed-height board cell, and a wide
pane. Read these signals defensively: the Control UI republishes them on every
resize, but the standalone host sends host context once and omits device
capabilities entirely, so absent is a normal case rather than an error.

| Container | Width | Behavior |
| --- | --- | --- |
| Narrow panel | under ~360px | Single column, stacked actions, truncate over wrap |
| Chat column | ~360–720px | The default composition |
| Wide pane | above ~720px | Multi-column permitted |

- Treat absent capabilities as the more accessible case rather than the
  default one. Hide an affordance behind hover only when `hover === true` and
  `touch === false`; a hybrid laptop reports both, and its touch users would
  lose the control. Size hit targets for touch unless `touch` is explicitly
  `false`. The standalone host omits capabilities entirely, so absent is the
  common case. Prefer the host capability when it arrives; there is no exact
  CSS equivalent, because `pointer` describes only the primary pointer and a
  hybrid matches `(pointer: fine)` while still having a touchscreen. The
  closest conservative guard is
  `@media (hover: hover) and (not (any-pointer: coarse))`, which holds only
  when no coarse pointer exists at all.
- The app must not paint its own outer card, border, or shadow. The frame is
  the card. The app's outermost element is a plain padded region on
  `--color-background-primary`.

## Rendering Tool Results

Presenting a tool result is the app's whole job, so the presentation signals in
the payload matter.

- Skip content blocks whose `annotations.audience` is present and does not
  include `"user"`. That is the payload saying a block is not for the reader.
  An omitted `audience` means every audience — do not treat it as a filter.
- Prefer `structuredContent` over re-parsing text blocks.
- Draw `isError: true` inside the app's own surface with
  `--color-text-danger` on `--color-background-danger`. The host frame does not
  render an app's tool errors.
- Resolve resource blocks by kind, and check the host capability before
  reaching for a request:
  - A `resource` block already carries its payload. Render it directly.
  - A `resource_link` is a URI to fetch, not a URL to navigate to. Read it back
    through the server-resources capability rather than linking to it.
  - An external `http`/`https` URL goes through the host's open-link request.
    Do not reach for a bare anchor: the sandbox attribute alone only stops the
    app navigating the *top-level* page, so depending on the host an anchor
    either replaces the app inside its own frame — the app appears to vanish —
    or is blocked outright. OpenClaw blocks it, because the trusted outer
    document's `frame-src` also governs replacement navigations of the inner
    frame. Neither outcome is the one the author wanted.
  - Downloads are a separate capability the host may not advertise. OpenClaw
    does not today, so offer a download only when the host negotiated one.
- Between tool input and tool result, show a skeleton sized like the result,
  not a spinner. Streaming partial input is provisional; never render it as
  final.

## What the Vocabulary Does Not Carry

The specification key set is closed, and several everyday roles are absent.
Apps must derive them rather than wait for a key:

| Missing role | Sanctioned recipe |
| --- | --- |
| Hover / active surface | `color-mix(in srgb, var(--color-text-primary) 8%, transparent)` over the surface |
| Link | `--color-text-info` |
| Selection | `color-mix()` from the ring color |
| Chart series | The four status hues plus the text tiers |
| Accent | App-owned; see Branding |

`--color-text-disabled` and `--color-text-ghost` deliberately collapse onto one
source today, and both ghost surfaces map to `transparent`, so a ghost control
has no hover treatment from the vocabulary alone — use the recipe above.

A host may publish any subset. Treat these as the set worth relying on, each
still written with a fallback: the surface, text, border, and ring primaries;
the four status roles across background, text, border, and ring; `--font-mono`; the four `--font-text-*-size`; the
radius ladder; and `--border-width-regular`.

## App Lifecycle

- The host may request teardown. Complete it synchronously or within roughly
  250ms — OpenClaw force-unmounts after that budget.
- Persist state as the user interacts, not at teardown. Teardown is too late.
- An app may request its own dismissal, but that is a request. The host may
  decline it, and the app must keep working if no teardown follows.

## Failure States

The frame owns the failure surface, and the useful distinction is who can fix
it. Copy that names the wrong owner sends the reader nowhere.

| Cause | Owner | Recovery |
| --- | --- | --- |
| Render or load failure | App author | Retry |
| Lease expired, or reclaimed under memory pressure | Host | Reload, no fault |
| Sandbox or routing misconfigured | Operator | Names the operator action; retry will not help |
| Wrong MIME, oversized resource, invalid CSP | Server author | Names the server, not the reader |
| Rate limited, or permission revoked mid-session | Host | Non-blocking notice; never unmount live content |

The last row matters most: the app is alive and painted, so replacing its body
destroys working content to report a partial degradation. Surface those beside
the content, not instead of it.

## Border Preference

Resource metadata carries a three-way border preference: request a visible
border and background, request neither, or omit and let the host decide. The
specification recommends servers set it explicitly, because host defaults vary.

A frameless app is not a smaller framed app. Without host chrome the app has no
separation from the surrounding conversation, so it should resolve its
outermost surface to `--color-background-secondary` — the page value — rather
than paint a card the host deliberately removed. Provenance still has to reach
the reader somehow. OpenClaw does not read this preference today.

## Ownership

This package owns the vocabulary translation, the embed font stacks, and the
branding rule. Hosts own extraction, validation, and transport. Apps own their
content, layout, and identity.
