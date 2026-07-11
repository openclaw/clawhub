import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function cssRule(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start, `Missing CSS rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("\n}", start);
  expect(end, `Unclosed CSS rule for ${selector}`).toBeGreaterThan(start);
  return css.slice(start, end + 2);
}

function cssMediaContaining(css: string, query: string, required: readonly string[]) {
  let start = css.indexOf(`@media ${query}`);
  while (start >= 0) {
    const nextMedia = css.indexOf("@media ", start + 1);
    const block = css.slice(start, nextMedia === -1 ? undefined : nextMedia);
    if (required.every((snippet) => block.includes(snippet))) return block;
    start = css.indexOf(`@media ${query}`, start + 1);
  }

  throw new Error(`Missing media query ${query} containing ${required.join(", ")}`);
}

function cssBlock(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start, `Missing CSS block for ${selector}`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("\n}", start);
  expect(end, `Unclosed CSS block for ${selector}`).toBeGreaterThan(start);
  return css.slice(start, end + 2);
}

function tokenValue(css: string, selector: string, token: string) {
  const block = cssBlock(css, selector);
  const match = block.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`));
  expect(match, `Missing ${token} in ${selector}`).toBeTruthy();
  return match![1];
}

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string) {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("restored UI design contract", () => {
  const rootRoute = () => read("src/routes/__root.tsx");
  const header = () => read("src/components/Header.tsx");
  const footer = () => read("src/components/Footer.tsx");
  const home = () => read("src/routes/index.tsx");
  const navItems = () => read("src/lib/nav-items.ts");
  const publicRegistry = () => read("src/lib/publicRegistry.ts");
  const settings = () => read("src/routes/settings.tsx");
  const styles = () => read("src/styles.css");
  const designSystemStyles = () => read("src/design-system.css");
  const theme = () => read("src/lib/theme.ts");

  it("loads the shared OpenClaw token adapter after the legacy application stylesheet", () => {
    const rootSource = rootRoute();
    const sharedCss = designSystemStyles();

    expect(sharedCss).toContain('@import "@openclaw/design-system/tokens.css";');
    expect(sharedCss).toContain('@import "@openclaw/design-system/typography.css";');
    expect(sharedCss).toContain('@import "@openclaw/design-system/themes/product.css";');
    expect(sharedCss).toContain('@import "@openclaw/design-system/components.css";');
    expect(sharedCss).toContain('@import "@openclaw/design-system/compat/clawhub.css";');
    expect(sharedCss).toContain(".home-v2-main.oc-app-surface");
    expect(sharedCss).toContain("--hv2-bg: var(--oc-bg-page)");
    expect(sharedCss).toContain("--hv2-text: var(--oc-text-primary)");
    expect(sharedCss).toContain("--hv2-accent: var(--oc-accent-primary)");
    expect(sharedCss).toContain("--hv2-radius-md: var(--oc-radius-surface)");
    expect(sharedCss).toContain("border-radius: var(--oc-radius-surface)");
    expect(sharedCss).toContain("border-radius: var(--oc-radius-control)");
    expect(sharedCss).toContain("border-radius: var(--oc-radius-inset)");
    expect(sharedCss).toContain("@media (max-width: 760px)");
    expect(sharedCss).toContain(
      ".home-v2-main .home-v2-popular-publishers-header.oc-section-header",
    );
    expect(sharedCss).toContain('[data-theme-family="claw"][data-theme-resolved="light"]');
    expect(sharedCss).toContain("--accent: var(--oc-accent-primary)");
    expect(sharedCss).toContain('[data-theme-family="claw"][data-theme-mode="system"]');
    expect(rootSource.indexOf("href: designSystemCss")).toBeGreaterThan(
      rootSource.indexOf("href: appCss"),
    );
  });

  it("uses semantic design-system geometry across landing controls and surfaces", () => {
    const css = styles();

    for (const selector of [
      ".home-v2-headline-trigger",
      ".home-v2-listing-search-bar",
      ".home-v2-listing-search-close",
      ".home-v2-listing-category-trigger",
    ]) {
      expect(cssRule(css, selector)).toContain("border-radius: var(--oc-radius-control)");
    }
    expect(cssRule(css, ".home-v2-promotion-title-icon")).toContain(
      "border-radius: var(--oc-radius-inset)",
    );
    expect(cssRule(css, ".home-v2-apps-workflow-tile")).toContain(
      "border-radius: var(--oc-radius-surface)",
    );
    expect(cssRule(css, ".home-v2-apps-tile-icon")).toContain(
      "border-radius: var(--oc-radius-inset)",
    );
    for (const selector of [
      "\n.marketplace-icon",
      ".browse-page .browse-results-grid .skill-card-header .marketplace-icon",
      ".home-v2-listing-card-icon .marketplace-icon",
      ".home-v2-listing-row-icon .marketplace-icon",
      ".home-v2-popular-publisher-card .marketplace-icon",
      ".navbar-search-typeahead-icon .marketplace-icon",
      ".browse-page .dashboard-catalog-row-icon .marketplace-icon",
    ]) {
      expect(cssRule(css, selector)).toContain("border-radius: var(--oc-radius-inset)");
    }
    expect(cssRule(css, ".marketplace-icon-user")).toContain(
      "border-radius: var(--oc-radius-round)",
    );
  });

  it("keeps migrated application surfaces on canonical semantic tokens", () => {
    const css = styles();
    const sharedCss = designSystemStyles();

    for (const legacyReference of [
      "var(--danger)",
      "var(--font-sans)",
      "var(--ink-faint)",
      "var(--surface-raised)",
      "var(--transition-fast)",
      "var(--card-border)",
      "var(--color-muted)",
      "var(--color-text)",
    ]) {
      expect(css).not.toContain(legacyReference);
    }

    expect(cssRule(css, ".dashboard-route")).toContain("--hv2-bg: var(--oc-bg-page)");
    expect(cssRule(css, ".dashboard-route")).toContain("--hv2-radius-md: var(--oc-radius-surface)");
    expect(sharedCss).toContain("--status-pending-bg: var(--oc-surface-interactive)");
    expect(sharedCss).toContain("--status-pending-fg: var(--oc-text-muted)");

    for (const sourcePath of [
      "src/components/SignInPrompt.tsx",
      "src/components/SkillOwnershipPanel.tsx",
      "src/routes/import.tsx",
      "src/routes/settings.tsx",
      "src/routes/skills/publish.tsx",
    ]) {
      expect(read(sourcePath)).not.toMatch(
        /(?:text|bg|border)-(?:red|amber|emerald)-(?:\d+|\[[^\]]+\])/,
      );
    }
  });

  it("keeps Vercel browser instrumentation mounted outside local dev", () => {
    const rootSource = rootRoute();

    expect(rootSource).toContain('import { Analytics } from "@vercel/analytics/react";');
    expect(rootSource).toContain('import { SpeedInsights } from "@vercel/speed-insights/react";');
    expect(rootSource).toContain('!["localhost", "127.0.0.1", "::1"].includes');
    expect(rootSource).toContain("{showAnalytics ? (");
    expect(rootSource).toContain("<Analytics />");
    expect(rootSource).toContain("<SpeedInsights />");
  });

  it("requires the responsive header rail, search overlay, and theme controls", () => {
    const headerSource = header();
    const navSource = navItems();
    const publicRegistrySource = publicRegistry();
    const css = styles();

    expect(headerSource).toContain('className="navbar-top"');
    expect(headerSource).toContain('className="navbar-calm-start"');
    expect(headerSource).toContain('className="navbar-calm-center"');
    expect(headerSource).toContain('className="navbar-calm-actions nav-actions"');
    expect(headerSource).toContain('className="navbar-calm-rail"');
    expect(headerSource).toContain('className="navbar-calm-more-trigger"');
    expect(headerSource).toContain('className="navbar-search-wrap"');
    expect(headerSource).toContain('className="navbar-search-mobile-trigger"');
    expect(headerSource).toContain('className="navbar-search-mobile-overlay"');
    expect(headerSource).toContain('className="navbar-search-mobile-wrap"');
    expect(headerSource).toContain('className="navbar-search-mobile-clear"');
    expect(headerSource).toContain('className="mobile-nav-section mobile-nav-appearance-section"');
    expect(headerSource).toContain('className="user-dropdown-theme-row"');
    expect(headerSource).toContain('className="user-dropdown-theme-button"');
    expect(headerSource).toContain('className="navbar-theme-switcher"');
    expect(headerSource).toContain('className="navbar-theme-switcher-skeleton"');
    expect(headerSource).not.toContain('className="theme-mode-toggle"');
    expect(headerSource).toContain('className="github-sign-in-button"');
    expect(headerSource).toContain('className="sign-in-full-copy"');
    expect(headerSource).toContain('className="sign-in-compact-copy"');
    expect(headerSource).toContain("Search skills, plugins, and creators");
    expect(headerSource).not.toContain('className="navbar-tabs-primary"');
    expect(headerSource).not.toContain('className="navbar-tabs-secondary"');

    expect(navSource).toContain("export const SECONDARY_NAV_ITEMS");
    expect(navSource).toContain('label: "Creators"');
    expect(navSource).toContain('label: "Docs"');
    expect(navSource).toContain("href: CLAWHUB_DOCS_URL");
    expect(publicRegistrySource).toContain(
      'export const CLAWHUB_DOCS_URL = "https://docs.openclaw.ai/clawhub/"',
    );
    expect(navSource).not.toContain('icon: "wrench"');
    expect(navSource).not.toContain('icon: "plug"');
    expect(navSource).not.toContain('label: "About"');
    expect(navSource).not.toContain('label: "Stars"');
    expect(navSource).not.toContain('label: "Management"');

    const headerShell = cssRule(css, ".navbar-inner");
    expect(headerShell).toContain("max-width: var(--page-max)");
    expect(headerShell).toContain("padding: 0 var(--space-5)");

    const topRow = cssRule(css, ".navbar-calm .navbar-top");
    expect(topRow).toContain(
      "grid-template-columns: minmax(0, 1fr) minmax(240px, 360px) minmax(0, 1fr)",
    );
    const rail = cssRule(css, ".navbar-calm .navbar-calm-rail");
    expect(rail).toContain("display: flex");
    const moreTrigger = cssRule(css, ".navbar-calm-more-trigger");
    expect(moreTrigger).toContain("cursor: pointer");
    expect(moreTrigger).toContain("border: 0");
    const moreMenu = cssRule(css, ".navbar-calm-more-menu");
    expect(moreMenu).toContain("border-radius: var(--r-md)");
    expect(css).toContain(".navbar-theme-switcher {\n  --navbar-theme-ease");
    expect(css).toContain("--navbar-theme-pad: 3px");
    expect(css).toContain("--navbar-theme-outer-r: var(--oc-radius-control)");
    expect(css).toContain("--navbar-theme-inner-r: var(--oc-radius-inset)");
    expect(css).toContain("--navbar-theme-seg: 26px");
    expect(css).toContain("height: var(--navbar-theme-collapsed-w)");
    const mobileDrawerTheme = cssRule(css, ".mobile-nav-appearance-section .navbar-theme-switcher");
    expect(mobileDrawerTheme).toContain("width: var(--navbar-theme-expanded-w)");
    const userDropdown = cssRule(css, ".user-dropdown-content");
    expect(userDropdown).toContain("border-radius: var(--r-md)");
    expect(userDropdown).toContain("overflow: hidden");
    const themeRow = cssRule(css, ".user-dropdown-theme-row");
    expect(themeRow).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
    const themeButton = cssRule(css, ".user-dropdown-theme-button");
    expect(themeButton).toContain("justify-content: center");
    expect(css).toContain("--r-btn: var(--r-sm)");

    cssMediaContaining(css, "(max-width: 1100px)", [
      ".navbar-calm-rail-link-secondary {\n    display: none;",
      ".navbar-calm-more-trigger {\n    display: inline-flex;",
    ]);
    cssMediaContaining(css, "(max-width: 920px)", [
      ".navbar-calm .navbar-calm-rail {\n    display: none;",
      ".navbar-calm-center .navbar-search-wrap {\n    position: static;",
      ".navbar-calm-center .navbar-search-typeahead {\n    top: calc(100% + 4px);",
      "width: auto;",
    ]);
    cssMediaContaining(css, "(max-width: 760px)", [
      "grid-template-columns: minmax(0, 1fr) auto",
      ".navbar-calm-center {\n    display: none;",
      ".navbar-calm .navbar-search-mobile-wrap {\n    display: block;",
      ".navbar-calm .navbar-search-mobile-overlay {\n    all: unset;",
      ".navbar-search-mobile-wrap .navbar-search-typeahead {\n    right: 0;",
      ".navbar-calm-actions > .navbar-theme-switcher,\n  .navbar-calm-actions > .navbar-theme-switcher-skeleton {\n    display: none;",
    ]);
    const compactMobileTrigger = cssRule(css, ".navbar-calm .nav-mobile");
    expect(compactMobileTrigger).toContain("display: inline-flex");
    const compact = css.slice(css.lastIndexOf("@media (max-width: 760px)"));
    expect(compact).not.toContain(".navbar-search {\n    display: none;");
  });

  it("requires the experiment hero and canonical home catalog without later sections", () => {
    const homeSource = home();
    const listingSource = read("src/components/HomeListingSection.tsx");
    const appsSource = read("src/components/HomeAppsSection.tsx");
    const publishersSource = read("src/components/HomePopularPublishersSection.tsx");
    const css = styles();

    expect(homeSource).toContain('className="home-v2-main oc-app-surface"');
    expect(homeSource).toContain("home-v2-headline oc-hero-title");
    expect(listingSource).toContain("home-v2-listing-card oc-card oc-card-interactive");
    expect(listingSource).toContain("home-v2-listing-kind clawhub-segmented");
    expect(appsSource).toContain("home-v2-apps-tile oc-card oc-card-interactive");
    expect(appsSource).toContain('className="home-v2-apps-workflow-header"');
    expect(appsSource).not.toContain('className="home-v2-apps-workflow-header oc-card"');
    expect(publishersSource).toContain(
      "home-v2-popular-publisher-card oc-card oc-card-interactive",
    );
    expect(homeSource).not.toContain("BUILT BY THE COMMUNITY");
    expect(homeSource).not.toContain("Unleash.");
    expect(homeSource).not.toContain("Ship.");
    expect(homeSource).not.toContain("Build.");
    expect(homeSource).not.toContain("Create.");
    expect(homeSource).toContain("Discover skills and plugins from top creators");
    expect(homeSource).not.toContain("home-v2-sub-stat");
    expect(homeSource).toContain("HomeListingSection");
    expect(homeSource).not.toContain("What are you looking for?");
    expect(homeSource).not.toContain("Featured skills");
    expect(homeSource).not.toContain("Trending Now");
    expect(listingSource).toContain("SKILL_CATEGORIES");
    expect(listingSource).toContain("PLUGIN_CATEGORIES");
    expect(listingSource).toContain("HomeListingCategorySelect");
    expect(cssRule(css, ".home-v2-listing-toolbar")).toContain("display: flex");
    expect(cssRule(css, ".home-v2-listing-grid")).toContain(
      "grid-template-columns: repeat(3, minmax(0, 1fr))",
    );
  });

  it("requires the restored footer columns and mobile section toggles", () => {
    const footerSource = footer();
    const navSource = navItems();
    const css = styles();

    expect(navSource).toContain('title: "Browse"');
    expect(navSource).toContain('title: "Publish"');
    expect(navSource).toContain('title: "Ecosystem"');
    expect(navSource).toContain('title: "Community"');
    expect(navSource).toContain('label: "Publish Skill"');
    expect(navSource).toContain('label: "Publish Plugin"');
    expect(navSource).toContain('label: "GitHub"');
    expect(navSource).toContain('label: "OpenClaw"');
    expect(navSource).toContain('label: "Status"');
    expect(navSource).toContain('label: "Deployed on Vercel"');
    expect(navSource).toContain('label: "Powered by Convex"');

    expect(footerSource).toContain('className="footer-col-toggle"');
    expect(footerSource).toContain("const ariaExpanded = isMobile ? isOpen : true");
    expect(footerSource).toContain("aria-expanded={ariaExpanded}");
    expect(footerSource).toContain("data-open={isOpen}");
    expect(footerSource).toContain("toggleSection(section.title)");

    cssMediaContaining(css, "(max-width: 760px)", [
      ".footer-grid {\n    grid-template-columns: 1fr;",
      ".footer-col-links {\n    display: none;",
      '.footer-col-links[data-open="true"] {\n    display: flex;',
    ]);
  });

  it("prevents reintroducing tweakcn overlays, custom visual preferences, or density controls", () => {
    expect(existsSync(join(root, "src/lib/customTheme.ts"))).toBe(false);
    expect(existsSync(join(root, "src/lib/preferences.ts"))).toBe(false);

    const settingsSource = settings();
    expect(settingsSource).not.toMatch(/tweakcn|custom theme|overlay/i);
    expect(settingsSource).not.toMatch(/density|relaxed|high contrast|code font size/i);
    expect(settingsSource).not.toMatch(/default view|experimental features/i);

    const themeSource = theme();
    expect(themeSource).toContain("cleanupLegacyVisualSettings");
    expect(themeSource).toContain("LEGACY_CUSTOM_THEME_KEY");
    expect(themeSource).toContain("LEGACY_PREFERENCES_KEY");
    expect(themeSource).toContain("DEFAULT_THEME_SELECTION");
    expect(themeSource).toContain("clearLegacyVisualCookies");
  });

  it("keeps runtime requirement text high contrast in both themes", () => {
    const css = styles();
    const designTokens = read("node_modules/@openclaw/design-system/styles/tokens.css");
    const installCardSource = read("src/components/SkillInstallCard.tsx");

    expect(installCardSource).toContain("requirements-env-row");
    expect(cssRule(css, ".tab-body.skill-install-tabs")).toContain("color: var(--ink)");
    expect(cssRule(css, ".requirements-env-main code")).toContain("color: var(--ink)");
    expect(cssRule(css, ".requirements-token,\n.requirements-badge")).toContain(
      "color: var(--ink)",
    );

    const darkRatio = contrastRatio(
      tokenValue(designTokens, ":root", "--oc-palette-ink-50"),
      tokenValue(designTokens, ":root", "--oc-palette-ink-900"),
    );
    const lightRatio = contrastRatio(
      tokenValue(designTokens, ":root", "--oc-palette-paper-950"),
      tokenValue(designTokens, ":root", "--oc-palette-paper-200"),
    );

    expect(darkRatio).toBeGreaterThanOrEqual(7);
    expect(lightRatio).toBeGreaterThanOrEqual(7);
  });

  it("keeps detail heroes full width unless an explicit sidebar is present", () => {
    const shellSource = read("src/components/DetailPageShell.tsx");
    const css = styles();

    expect(shellSource).toContain('"skill-hero-layout has-sidebar"');
    expect(cssRule(css, ".skill-hero-layout")).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(cssRule(css, ".skill-hero-lower.has-sidebar")).toContain(
      "grid-template-columns: minmax(0, 1fr) minmax(300px, 360px)",
    );
    expect(cssRule(css, ".skill-hero-main-extra")).toContain("overflow-x: clip");
    expect(cssRule(css, ".skill-install-command-shell")).toContain("max-width: 100%");
    expect(cssRule(css, ".skill-hero-action-grid")).toContain(
      "grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr))",
    );
  });

  it("keeps promotion cards within narrow mobile viewports", () => {
    const css = styles();

    expect(cssRule(css, ".home-v2-promotions")).toContain("padding: 0 48px 56px");
    expect(cssRule(css, ".home-v2-promotions-track")).toContain("display: grid");
    expect(css).toContain("padding: 0 20px 48px");
  });

  it("keeps typeahead creator avatars round for users and square for orgs", () => {
    const css = styles();

    expect(cssRule(css, ".navbar-search-typeahead-icon .marketplace-icon-user")).toContain(
      "border-radius: var(--oc-radius-round)",
    );
    expect(cssRule(css, ".navbar-search-typeahead-icon .marketplace-icon-org")).toContain(
      "border-radius: var(--oc-radius-inset)",
    );
    expect(
      cssRule(css, ".navbar-search-typeahead-icon .marketplace-icon-user .marketplace-icon-image"),
    ).toContain("filter: none");
    expect(
      cssRule(css, ".navbar-search-typeahead-icon .marketplace-icon-org .marketplace-icon-image"),
    ).toContain("filter: grayscale(1)");
    expect(
      cssRule(
        css,
        ".navbar-search-typeahead-icon .marketplace-icon-user:has(.marketplace-icon-image)",
      ),
    ).toContain("background: transparent");
  });
});
