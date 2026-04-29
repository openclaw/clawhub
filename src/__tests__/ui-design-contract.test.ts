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

function cssMedia(css: string, query: string) {
  const start = css.indexOf(`@media ${query}`);
  expect(start, `Missing media query ${query}`).toBeGreaterThanOrEqual(0);
  const nextMedia = css.indexOf("@media ", start + 1);
  return css.slice(start, nextMedia === -1 ? undefined : nextMedia);
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

describe("restored UI design contract", () => {
  const header = () => read("src/components/Header.tsx");
  const footer = () => read("src/components/Footer.tsx");
  const home = () => read("src/routes/index.tsx");
  const navItems = () => read("src/lib/nav-items.ts");
  const settings = () => read("src/routes/settings.tsx");
  const styles = () => read("src/styles.css");
  const theme = () => read("src/lib/theme.ts");

  it("requires the restored two-row header, full-width search, public nav, and theme control", () => {
    const headerSource = header();
    const navSource = navItems();
    const css = styles();

    expect(headerSource).toContain("Row 1: Brand + Search + Actions");
    expect(headerSource).toContain('className="navbar-top"');
    expect(headerSource).toContain('className="navbar-search-wrap"');
    expect(headerSource).toContain('className="theme-mode-toggle"');
    expect(headerSource).toContain('className="github-sign-in-button"');
    expect(headerSource).toContain('className="sign-in-full-copy"');
    expect(headerSource).toContain('className="sign-in-compact-copy"');
    expect(headerSource).toContain("Search skills, plugins, users");
    expect(headerSource).toContain('className="navbar-tabs-primary"');
    expect(headerSource).toContain('className="navbar-tabs-secondary"');

    expect(navSource).toContain("export const SECONDARY_NAV_ITEMS");
    expect(navSource).toContain('label: "Users"');
    expect(navSource).toContain('label: "About"');
    expect(navSource).not.toContain('label: "Stars"');
    expect(navSource).not.toContain('label: "Management"');

    const headerShell = cssRule(css, ".navbar-inner");
    expect(headerShell).toContain("max-width: var(--page-max)");
    expect(headerShell).toContain("padding: 0 var(--space-5)");

    const themeControl = cssRule(css, ".theme-mode-toggle");
    expect(themeControl).toContain("min-width: 154px");
    expect(themeControl).toContain("min-height: 50px");
    expect(themeControl).toContain("border: 1px solid var(--line)");

    const compact = cssMedia(css, "(max-width: 760px)");
    expect(compact).toContain("grid-template-columns: 56px minmax(0, 1fr) 56px");
    expect(compact).toContain(".navbar-search {\n    display: flex;");
    expect(compact).toContain(".navbar-tabs {\n    display: flex;");
    expect(compact).toContain(".navbar-tabs-secondary {\n    display: inline-flex;");
    expect(compact).not.toContain(".navbar-search {\n    display: none;");
    expect(compact).not.toContain(".navbar-tabs {\n    display: none;");
  });

  it("requires the restored home hero, carousel, category grid, and Trending Now sections", () => {
    const homeSource = home();
    const css = styles();

    expect(homeSource).toContain("BUILT BY THE COMMUNITY.");
    expect(homeSource).toContain("Tools built by thousands, ready in one search.");
    expect(homeSource).toContain("api.skills.listHighlightedPublic");
    expect(homeSource).toContain("api.skills.listPublicPageV4");
    expect(homeSource).toContain("const [popular, setPopular]");
    expect(homeSource).toContain('className="home-v2-carousel-section"');
    expect(homeSource).toContain(
      'data-source={carouselUsesHighlighted ? "highlighted" : "popular"}',
    );
    expect(homeSource).toContain("Featured skills");
    expect(homeSource).toContain("const categoryCount = FEATURE_SOULS ? 4 : 3");
    expect(homeSource).toContain("data-layout={categoryLayout}");
    expect(homeSource).toContain("Trending Now");
    expect(homeSource).toContain('className="home-v2-trending-grid"');

    const searchShell = cssRule(css, ".home-v2-search-bar");
    expect(searchShell).toContain("border: 1px solid var(--hv2-border-strong)");
    expect(searchShell).not.toContain("border-color: var(--hv2-accent-border)");

    const searchFocus = cssRule(css, ".home-v2-search-bar:focus-within");
    expect(searchFocus).toContain("border-color: var(--hv2-accent-border)");

    const categories = cssRule(css, ".home-v2-categories-grid");
    expect(categories).toContain("--home-v2-category-columns: 3");
    expect(categories).toContain("grid-template-columns: repeat(var(--home-v2-category-columns)");
    expect(cssRule(css, '.home-v2-categories-grid[data-count="4"]')).toContain(
      "--home-v2-category-columns: 4",
    );

    const trending = cssRule(css, ".home-v2-trending-grid");
    expect(trending).toContain("grid-template-columns: repeat(3, 1fr)");
    cssMediaContaining(css, "(max-width: 1024px)", [
      ".home-v2-trending-grid {\n    grid-template-columns: repeat(2, 1fr);",
    ]);
    cssMediaContaining(css, "(max-width: 768px)", [
      ".home-v2-trending-grid {\n    grid-template-columns: 1fr;",
    ]);
  });

  it("requires the restored footer columns and mobile section toggles", () => {
    const footerSource = footer();
    const navSource = navItems();
    const css = styles();

    expect(navSource).toContain('title: "Browse"');
    expect(navSource).toContain('title: "Publish"');
    expect(navSource).toContain('title: "Community"');
    expect(navSource).toContain('title: "Platform"');
    expect(navSource).toContain('label: "Publish Skill"');
    expect(navSource).toContain('label: "Publish Plugin"');
    expect(navSource).toContain('label: "GitHub"');
    expect(navSource).toContain('label: "OpenClaw"');
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
    expect(settingsSource).not.toMatch(/density|compact|relaxed|high contrast|code font size/i);
    expect(settingsSource).not.toMatch(/default view|experimental features/i);

    const themeSource = theme();
    expect(themeSource).toContain("cleanupLegacyVisualSettings");
    expect(themeSource).toContain("LEGACY_CUSTOM_THEME_KEY");
    expect(themeSource).toContain("LEGACY_PREFERENCES_KEY");
    expect(themeSource).toContain("DEFAULT_THEME_SELECTION");
    expect(themeSource).toContain("clearLegacyVisualCookies");
  });
});
