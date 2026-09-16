# Opaque sticky header

The shared navbar uses the opaque, theme-aware `--nav-bg` surface on every route,
both at the top of the page and while scrolling. Page headings and body content
must not show through navigation, including when search suggestions are open.

Route-specific hero treatments may remove the header border, but must not make
its background transparent. Light and dark themes retain their own page colors.

The previous detail/home overrides made the header transparent at the top and
78% opaque after scrolling. Shared scroll and search overrides added other glass
treatments. Removing these overrides restores the base navbar invariant and
eliminates the scroll listener whose only purpose was switching those treatments.

Verify in a real browser on the security audit page with its heading scrolled
behind the header, on the homepage, and with search suggestions open. Check
desktop/mobile and light/dark; the header's computed background alpha must remain
1 without horizontal overflow.
