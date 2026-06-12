#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const site = path.join(root, "dist", "docs-site");
const artifacts = process.env.DOCS_VISUAL_ARTIFACT_DIR || path.join(root, ".cache", "docs-visual");

if (!fs.existsSync(path.join(site, "__elements", "index.html"))) {
  throw new Error("visual smoke requires a built dist/docs-site");
}

fs.mkdirSync(artifacts, { recursive: true });
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const candidates = [path.join(site, pathname), path.join(site, pathname, "index.html")];
  const file = candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
  if (!file || !file.startsWith(site)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.setHeader("content-type", contentType(file));
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });

try {
  await checkDesktop();
  await checkTocScrollspy();
  await checkAmbientCodePage();
  await checkMobile();
  await checkLightMode();
  console.log(`docs visual smoke ok: screenshots in ${path.relative(root, artifacts)}`);
} finally {
  await browser.close();
  server.close();
}

async function checkDesktop() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${base}/__elements`, { waitUntil: "networkidle" });
  await page.screenshot({
    path: path.join(artifacts, "elements-desktop-dark.png"),
    fullPage: true,
  });
  await page.evaluate(() => scrollTo(0, 760));
  await page.screenshot({
    path: path.join(artifacts, "elements-desktop-scrolled.png"),
    fullPage: false,
  });

  const overlap = await page.evaluate(() => {
    const header = document.querySelector(".site-header")?.getBoundingClientRect();
    const sidebar = document.querySelector(".sidebar")?.getBoundingClientRect();
    const toc = document.querySelector(".toc")?.getBoundingClientRect();
    return {
      headerTop: header?.top,
      sidebarClear: header && sidebar ? sidebar.top >= header.bottom - 1 : false,
      tocClear: header && toc ? toc.top >= header.bottom - 1 : false,
    };
  });
  if (overlap.headerTop !== 0 || !overlap.sidebarClear || !overlap.tocClear) {
    throw new Error(`desktop sticky shell overlap: ${JSON.stringify(overlap)}`);
  }

  await expectVisible(page, ".oc-code [data-code-copy]", "code copy button");
  await expectVisible(page, ".page-status .page-status-beta", "page status badge");
  await expectVisible(
    page,
    ".oc-code.has-line-numbers .code-line.is-highlighted",
    "line-highlighted code",
  );
  await expectVisible(page, ".oc-badge.oc-badge-orange", "badge");
  await expectVisible(page, ".oc-panel", "panel");
  await expectVisible(page, ".oc-prompt [data-prompt-copy]", "prompt copy");
  await expectVisible(page, ".oc-tile-group .oc-tile", "tiles");
  await expectVisible(page, ".oc-mermaid", "mermaid block");
  await page
    .locator(".oc-mermaid.is-rendered svg")
    .first()
    .waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".oc-mermaid.is-rendered")].some(
      (block) => block.getAttribute("data-mermaid")?.includes("<br>") && block.querySelector("svg"),
    ),
  );
  await page
    .locator(".oc-mermaid.is-error pre code")
    .first()
    .waitFor({ state: "visible", timeout: 10000 });
  const mermaidErrorLeak = await page.evaluate(() => ({
    bodyText: document.body.innerText.includes("Syntax error in text"),
    leakedSvg: [...document.querySelectorAll("svg")].some(
      (svg) => !svg.closest("[data-mermaid]") && svg.textContent?.includes("Syntax error in text"),
    ),
  }));
  if (mermaidErrorLeak.bodyText || mermaidErrorLeak.leakedSvg) {
    throw new Error(
      `mermaid error artifact leaked into shell: ${JSON.stringify(mermaidErrorLeak)}`,
    );
  }
  const componentSkin = await page.evaluate(() => {
    const code = getComputedStyle(document.querySelector(".oc-code"));
    const pre = getComputedStyle(document.querySelector(".oc-code pre"));
    const step = getComputedStyle(document.querySelector(".oc-step:last-child"));
    const paramType = getComputedStyle(document.querySelector(".oc-param-type"));
    const lineRects = [...document.querySelectorAll(".oc-code.has-line-numbers .code-line")]
      .slice(0, 3)
      .map((line) => line.getBoundingClientRect());
    return {
      codeBg: code.backgroundColor,
      codePadding: pre.paddingTop,
      stepBorderImage: step.borderImageSource,
      paramTypeColor: paramType.color,
      codeLineGap: lineRects.length > 1 ? lineRects[1].top - lineRects[0].bottom : 0,
    };
  });
  if (
    componentSkin.codeBg !== "rgb(16, 16, 16)" ||
    parseFloat(componentSkin.codePadding) > 14 ||
    !componentSkin.stepBorderImage.includes("linear-gradient") ||
    componentSkin.paramTypeColor === "rgb(129, 122, 118)" ||
    componentSkin.codeLineGap > 3
  ) {
    throw new Error(`desktop component skin failed: ${JSON.stringify(componentSkin)}`);
  }
  const stepCodeSpacing = await page.evaluate(() => {
    const code = document.querySelector(".oc-step .oc-code");
    const next = code?.nextElementSibling;
    const codeRect = code?.getBoundingClientRect();
    const nextRect = next?.getBoundingClientRect();
    return {
      nextTag: next?.tagName,
      gap: codeRect && nextRect ? Math.round(nextRect.top - codeRect.bottom) : null,
    };
  });
  if (stepCodeSpacing.nextTag !== "P" || (stepCodeSpacing.gap ?? 0) < 14) {
    throw new Error(`step code block spacing failed: ${JSON.stringify(stepCodeSpacing)}`);
  }
  const cardGrids = await page.evaluate(() => {
    const countColumns = (grid) => {
      const cards = [...grid.querySelectorAll(":scope > .oc-card")];
      const firstTop = cards[0]?.getBoundingClientRect().top ?? 0;
      return cards.filter((card) => Math.abs(card.getBoundingClientRect().top - firstTop) < 2)
        .length;
    };
    return Object.fromEntries(
      [1, 2, 3, 4].map((cols) => {
        const grids = [...document.querySelectorAll(`.oc-card-grid.oc-card-cols-${cols}`)];
        return [
          cols,
          grids.map((grid) => ({
            columns: countColumns(grid),
            template: getComputedStyle(grid).gridTemplateColumns,
            width: grid.getBoundingClientRect().width,
          })),
        ];
      }),
    );
  });
  const expectedCardColumns = (requested, width) => {
    if (width <= 520) return 1;
    if (requested === 4 && width <= 720) return 2;
    if (requested === 3 && width <= 620) return 2;
    return requested;
  };
  if (
    [1, 2, 3, 4].some(
      (requested) =>
        !cardGrids[String(requested)]?.length ||
        !cardGrids[String(requested)].every(
          (grid) => grid.columns === expectedCardColumns(requested, grid.width),
        ),
    ) ||
    (cardGrids["4"] ?? []).length < 2
  ) {
    throw new Error(`desktop card column contract failed: ${JSON.stringify(cardGrids)}`);
  }
  await page.setViewportSize({ width: 1900, height: 1000 });
  await page.goto(`${base}/__elements`, { waitUntil: "networkidle" });
  const wideCardGrids = await page.evaluate(() => {
    const countColumns = (grid) => {
      const cards = [...grid.querySelectorAll(":scope > .oc-card")];
      const firstTop = cards[0]?.getBoundingClientRect().top ?? 0;
      return cards.filter((card) => Math.abs(card.getBoundingClientRect().top - firstTop) < 2)
        .length;
    };
    return Object.fromEntries(
      [1, 2, 3, 4].map((cols) => {
        const grids = [...document.querySelectorAll(`.oc-card-grid.oc-card-cols-${cols}`)];
        return [
          cols,
          grids.map((grid) => ({
            columns: countColumns(grid),
            width: grid.getBoundingClientRect().width,
          })),
        ];
      }),
    );
  });
  if (
    wideCardGrids["1"]?.[0]?.columns !== 1 ||
    wideCardGrids["2"]?.[0]?.columns !== 2 ||
    wideCardGrids["3"]?.[0]?.columns !== 3 ||
    (wideCardGrids["4"] ?? []).length < 2 ||
    !wideCardGrids["4"].every((grid) => grid.columns === 4)
  ) {
    throw new Error(`wide desktop card column contract failed: ${JSON.stringify(wideCardGrids)}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await expectVisible(page, ".page-tools [data-copy-page]", "copy page tool");
  const pageActionPrimary = await page.evaluate(() => {
    const control = document.querySelector(".page-actions-primary");
    const label = control?.querySelector("[data-copy-feedback]");
    const controlRect = control?.getBoundingClientRect();
    const labelRect = label?.getBoundingClientRect();
    const iconRect = control?.querySelector(".icon")?.getBoundingClientRect();
    const style = control ? getComputedStyle(control) : null;
    return {
      whiteSpace: style?.whiteSpace,
      controlHeight: controlRect?.height,
      labelHeight: labelRect?.height,
      sameLine: iconRect && labelRect ? Math.abs(iconRect.top - labelRect.top) < 4 : false,
    };
  });
  if (
    pageActionPrimary.whiteSpace !== "nowrap" ||
    (pageActionPrimary.labelHeight ?? 0) > (pageActionPrimary.controlHeight ?? 0) ||
    !pageActionPrimary.sameLine
  ) {
    throw new Error(`page action primary wrapping failed: ${JSON.stringify(pageActionPrimary)}`);
  }
  await expectVisible(page, ".page-feedback [data-feedback-value='yes']", "page feedback");
  const searchShortcut = await page.evaluate(() => {
    const key = document.querySelector(".search-shortcut");
    const style = key ? getComputedStyle(key) : null;
    const rect = key?.getBoundingClientRect();
    return {
      display: style?.display,
      text: key?.textContent?.trim(),
      hasCommandIcon: Boolean(key?.querySelector(".icon-command")),
      width: rect?.width,
      height: rect?.height,
      borderRadius: style?.borderRadius,
      backgroundColor: style?.backgroundColor,
      fontSize: style?.fontSize,
    };
  });
  if (
    searchShortcut.text !== "K" ||
    !searchShortcut.hasCommandIcon ||
    searchShortcut.width > 32 ||
    searchShortcut.height > 18 ||
    parseFloat(searchShortcut.borderRadius ?? "0") !== 0 ||
    searchShortcut.backgroundColor !== "rgba(0, 0, 0, 0)"
  ) {
    throw new Error(`search shortcut inline hint failed: ${JSON.stringify(searchShortcut)}`);
  }
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.waitForFunction(
    () =>
      document.querySelector(".search-modal")?.classList.contains("open") &&
      document.activeElement?.matches("[data-search-input]"),
  );
  const searchOpen = await page.evaluate(() => ({
    open: document.querySelector(".search-modal")?.classList.contains("open"),
    focused: document.activeElement?.matches("[data-search-input]"),
  }));
  if (!searchOpen.open || !searchOpen.focused) {
    throw new Error(`search shortcut did not open and focus input: ${JSON.stringify(searchOpen)}`);
  }
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const textarea = document.createElement("textarea");
    textarea.dataset.shortcutSmoke = "true";
    document.body.append(textarea);
    textarea.focus();
  });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  const editableShortcut = await page.evaluate(() => ({
    open: document.querySelector(".search-modal")?.classList.contains("open"),
    focused: document.activeElement?.matches("[data-shortcut-smoke]"),
  }));
  if (editableShortcut.open || !editableShortcut.focused) {
    throw new Error(
      `search shortcut hijacked editable target: ${JSON.stringify(editableShortcut)}`,
    );
  }
  await page.evaluate(() => document.querySelector("[data-shortcut-smoke]")?.remove());
  await page.waitForTimeout(350);
  const initialFloatingChat = await page.evaluate(() => {
    const chat = document.querySelector(".docs-chat");
    const panel = document.querySelector(".docs-chat-panel");
    const main = document.querySelector(".main");
    const panelStyle = panel ? getComputedStyle(panel) : null;
    return {
      open: chat?.classList.contains("open"),
      panelDisplay: panelStyle?.display,
      panelOpacity: panelStyle?.opacity,
      panelTransform: panelStyle?.transform,
      panelInert: panel?.hasAttribute("inert"),
      panelAriaHidden: panel?.getAttribute("aria-hidden"),
      bodyPaddingRight: getComputedStyle(document.body).paddingRight,
      mainRight: main?.getBoundingClientRect().right,
    };
  });
  if (
    initialFloatingChat.open ||
    initialFloatingChat.panelDisplay !== "grid" ||
    initialFloatingChat.panelOpacity !== "0" ||
    initialFloatingChat.panelTransform === "none" ||
    !initialFloatingChat.panelInert ||
    initialFloatingChat.panelAriaHidden !== "true" ||
    parseFloat(initialFloatingChat.bodyPaddingRight ?? "0") !== 0
  ) {
    throw new Error(
      `initial floating chat should be minimized: ${JSON.stringify(initialFloatingChat)}`,
    );
  }
  await page.click("[data-chat-toggle]");
  await page.waitForTimeout(350);
  const floatingChat = await page.evaluate(() => {
    const chat = document.querySelector(".docs-chat");
    const panel = document.querySelector(".docs-chat-panel");
    const main = document.querySelector(".main");
    const copy = document.querySelector("[data-chat-copy]");
    const retry = document.querySelector("[data-chat-retry]");
    const maximize = document.querySelector("[data-chat-maximize]");
    const chatRect = chat?.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    const mainRect = main?.getBoundingClientRect();
    const panelStyle = panel ? getComputedStyle(panel) : null;
    return {
      open: chat?.classList.contains("open"),
      bodyPaddingRight: getComputedStyle(document.body).paddingRight,
      panelDisplay: panelStyle?.display,
      panelOpacity: panelStyle?.opacity,
      panelTransform: panelStyle?.transform,
      panelRight: panelRect ? Math.round(innerWidth - panelRect.right) : null,
      panelBottom: panelRect ? Math.round(innerHeight - panelRect.bottom) : null,
      panelHeight: panelRect?.height,
      panelWidth: panelRect?.width,
      panelInert: panel?.hasAttribute("inert"),
      panelAriaHidden: panel?.getAttribute("aria-hidden"),
      chatWidth: chatRect?.width,
      mainRight: mainRect?.right,
      copyHidden: copy?.hasAttribute("hidden"),
      retryHidden: retry?.hasAttribute("hidden"),
      retryDisabled: retry?.hasAttribute("disabled"),
      maximizePressed: maximize?.getAttribute("aria-pressed"),
    };
  });
  if (
    !floatingChat.open ||
    floatingChat.panelDisplay !== "grid" ||
    floatingChat.panelOpacity !== "1" ||
    floatingChat.panelRight !== 18 ||
    floatingChat.panelBottom !== 18 ||
    floatingChat.panelHeight < 640 ||
    floatingChat.panelHeight > 680 ||
    floatingChat.panelWidth < 400 ||
    floatingChat.panelWidth > 420 ||
    floatingChat.panelInert ||
    floatingChat.panelAriaHidden !== "false" ||
    floatingChat.chatWidth < 400 ||
    parseFloat(floatingChat.bodyPaddingRight ?? "0") !== 0 ||
    floatingChat.mainRight !== initialFloatingChat.mainRight ||
    !floatingChat.copyHidden ||
    !floatingChat.retryHidden ||
    !floatingChat.retryDisabled ||
    floatingChat.maximizePressed !== "false"
  ) {
    throw new Error(`floating desktop chat failed: ${JSON.stringify(floatingChat)}`);
  }
  await page.click("[data-chat-maximize]");
  await page.waitForTimeout(350);
  const expandedFloatingChat = await page.evaluate(() => {
    const chat = document.querySelector(".docs-chat");
    const panel = document.querySelector(".docs-chat-panel");
    const main = document.querySelector(".main");
    const maximize = document.querySelector("[data-chat-maximize]");
    const chatRect = chat?.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    const mainRect = main?.getBoundingClientRect();
    return {
      expanded: chat?.classList.contains("expanded"),
      chatWidth: chatRect?.width,
      panelHeight: panelRect?.height,
      panelWidth: panelRect?.width,
      panelRight: panelRect ? Math.round(innerWidth - panelRect.right) : null,
      panelBottom: panelRect ? Math.round(innerHeight - panelRect.bottom) : null,
      mainRight: mainRect?.right,
      bodyPaddingRight: getComputedStyle(document.body).paddingRight,
      maximizePressed: maximize?.getAttribute("aria-pressed"),
      maximizeLabel: maximize?.getAttribute("aria-label"),
    };
  });
  if (
    !expandedFloatingChat.expanded ||
    expandedFloatingChat.chatWidth < 720 ||
    expandedFloatingChat.panelWidth < 720 ||
    expandedFloatingChat.panelHeight < 820 ||
    expandedFloatingChat.panelRight !== 18 ||
    expandedFloatingChat.panelBottom !== 18 ||
    parseFloat(expandedFloatingChat.bodyPaddingRight ?? "0") !== 0 ||
    expandedFloatingChat.mainRight !== initialFloatingChat.mainRight ||
    expandedFloatingChat.maximizePressed !== "true" ||
    expandedFloatingChat.maximizeLabel !== "Restore docs assistant size"
  ) {
    throw new Error(
      `expanded floating desktop chat failed: ${JSON.stringify(expandedFloatingChat)}`,
    );
  }
  await page.click("[data-chat-minimize]");
  await page.waitForTimeout(350);
  const minimizedFloatingChat = await page.evaluate(() => {
    const chat = document.querySelector(".docs-chat");
    const panel = document.querySelector(".docs-chat-panel");
    const panelStyle = panel ? getComputedStyle(panel) : null;
    return {
      open: chat?.classList.contains("open"),
      panelDisplay: panelStyle?.display,
      panelOpacity: panelStyle?.opacity,
      panelTransform: panelStyle?.transform,
      bodyPaddingRight: getComputedStyle(document.body).paddingRight,
    };
  });
  if (
    minimizedFloatingChat.open ||
    minimizedFloatingChat.panelDisplay !== "grid" ||
    minimizedFloatingChat.panelOpacity !== "0" ||
    minimizedFloatingChat.panelTransform === "none" ||
    parseFloat(minimizedFloatingChat.bodyPaddingRight ?? "0") !== 0
  ) {
    throw new Error(
      `minimized floating desktop chat failed: ${JSON.stringify(minimizedFloatingChat)}`,
    );
  }
  await page.goto(`${base}/start/showcase`, { waitUntil: "networkidle" });
  await page.waitForTimeout(350);
  const showcaseCardGrid = await page.evaluate(() => {
    const grid = document.querySelector(".oc-card-grid.oc-card-cols-2");
    const cards = [...(grid?.querySelectorAll(":scope > .oc-card") ?? [])];
    const firstTop = cards[0]?.getBoundingClientRect().top ?? 0;
    const columns = cards.filter(
      (card) => Math.abs(card.getBoundingClientRect().top - firstTop) < 2,
    ).length;
    return {
      exists: Boolean(grid),
      cardCount: cards.length,
      columns,
      width: grid?.getBoundingClientRect().width,
      template: grid ? getComputedStyle(grid).gridTemplateColumns : "",
    };
  });
  if (
    !showcaseCardGrid.exists ||
    showcaseCardGrid.cardCount === 0 ||
    showcaseCardGrid.columns > 2 ||
    ((showcaseCardGrid.width ?? 0) > 520 && showcaseCardGrid.columns !== 2)
  ) {
    throw new Error(`showcase card grid columns failed: ${JSON.stringify(showcaseCardGrid)}`);
  }
  await page.close();
}

async function checkTocScrollspy() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/channels/discord`, { waitUntil: "networkidle" });
  await page.locator(".toc a").first().waitFor({ state: "visible" });
  const initial = await page.evaluate(() => ({
    active: [...document.querySelectorAll(".toc a.active")].map((link) => link.hash),
    tocCount: document.querySelectorAll(".toc a").length,
  }));
  if (initial.tocCount < 4 || initial.active.length !== 1) {
    throw new Error(`toc initial active state failed: ${JSON.stringify(initial)}`);
  }

  const scrolled = await scrollToTocItem(page, 4);
  if (!scrolled || scrolled.activeHash !== scrolled.expectedHash || scrolled.scrollY < 700) {
    throw new Error(`toc scrollspy failed on long page: ${JSON.stringify(scrolled)}`);
  }

  await page.click('a.nav-link[href$="/channels/telegram"]');
  await page.waitForURL("**/channels/telegram");
  await page.locator(".toc a").first().waitFor({ state: "visible" });
  const afterPjax = await scrollToTocItem(page, 2);
  if (
    !afterPjax ||
    afterPjax.pathname !== "/channels/telegram" ||
    afterPjax.activeHash !== afterPjax.expectedHash ||
    afterPjax.activeCount !== 1
  ) {
    throw new Error(`toc scrollspy failed after PJAX navigation: ${JSON.stringify(afterPjax)}`);
  }
  await page.close();
}

async function scrollToTocItem(page, index) {
  const expected = await page.evaluate((targetIndex) => {
    const links = [...document.querySelectorAll(".toc a")];
    const items = links
      .map((link) => ({ hash: link.hash, id: decodeURIComponent(link.hash.slice(1)) }))
      .filter((item) => item.id && document.getElementById(item.id));
    const item = items[Math.min(targetIndex, items.length - 1)];
    document.getElementById(item?.id)?.scrollIntoView();
    return item?.hash ?? null;
  }, index);
  if (!expected) return null;
  await page.waitForFunction(
    (hash) => [...document.querySelectorAll(".toc a.active")].some((link) => link.hash === hash),
    expected,
  );
  return page.evaluate((expectedHash) => {
    const active = [...document.querySelectorAll(".toc a.active")];
    return {
      expectedHash,
      activeHash: active[0]?.hash ?? null,
      activeCount: active.length,
      pathname: location.pathname,
      scrollY,
    };
  }, expected);
}

async function checkMobile() {
  const page = await browser.newPage({ viewport: { width: 390, height: 980 }, isMobile: true });
  await page.goto(`${base}/__elements`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(artifacts, "elements-mobile-dark.png"), fullPage: true });

  const geometry = await page.evaluate(() => {
    const header = document.querySelector(".site-header")?.getBoundingClientRect();
    const menu = document.querySelector("[data-nav-toggle]")?.getBoundingClientRect();
    const theme = document.querySelector("[data-theme-toggle]")?.getBoundingClientRect();
    const search = document.querySelector("[data-search-open]")?.getBoundingClientRect();
    const code = document.querySelector(".oc-code")?.getBoundingClientRect();
    const step = document.querySelector(".oc-step")?.getBoundingClientRect();
    const overlap = (a, b) =>
      Boolean(
        a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
      );
    return {
      headerWidth: header?.width,
      menuThemeOverlap: overlap(menu, theme),
      searchInViewport: search ? search.left >= 0 && search.right <= innerWidth : false,
      codeInViewport: code ? code.left >= 0 && code.right <= innerWidth + 1 : false,
      stepInset: step?.left,
    };
  });
  if (
    geometry.menuThemeOverlap ||
    !geometry.searchInViewport ||
    !geometry.codeInViewport ||
    geometry.stepInset < 0
  ) {
    throw new Error(`mobile visual geometry failed: ${JSON.stringify(geometry)}`);
  }
  const mobileCardColumns = await page.evaluate(() => {
    const countColumns = (grid) => {
      const cards = [...grid.querySelectorAll(":scope > .oc-card")];
      const firstTop = cards[0]?.getBoundingClientRect().top ?? 0;
      return cards.filter((card) => Math.abs(card.getBoundingClientRect().top - firstTop) < 2)
        .length;
    };
    return [...document.querySelectorAll(".oc-card-grid")].map((grid) => countColumns(grid));
  });
  if (!mobileCardColumns.length || mobileCardColumns.some((columns) => columns !== 1)) {
    throw new Error(
      `mobile card grids should collapse to one column: ${JSON.stringify(mobileCardColumns)}`,
    );
  }
  await page.click("[data-nav-toggle]");
  await page.locator(".sidebar.open").waitFor({ state: "visible" });
  await page.waitForFunction(
    () => Math.abs(document.querySelector(".sidebar")?.getBoundingClientRect().left ?? -999) < 1,
  );
  await page.screenshot({
    path: path.join(artifacts, "elements-mobile-menu.png"),
    fullPage: false,
  });
  const menu = await page.evaluate(() => {
    const sidebar = document.querySelector(".sidebar")?.getBoundingClientRect();
    const close = document.querySelector("[data-nav-close]")?.getBoundingClientRect();
    const toggle = document.querySelector("[data-nav-toggle]");
    const closeStyle = getComputedStyle(document.querySelector("[data-nav-close]"));
    return {
      bodyOpen: document.body.classList.contains("nav-open"),
      ariaExpanded: toggle?.getAttribute("aria-expanded"),
      sidebarLeft: sidebar?.left,
      sidebarRight: sidebar?.right,
      sidebarWidth: sidebar?.width,
      closeVisible: closeStyle.display !== "none" && close && close.height >= 36,
      viewport: innerWidth,
    };
  });
  if (
    !menu.bodyOpen ||
    menu.ariaExpanded !== "true" ||
    menu.sidebarLeft !== 0 ||
    menu.sidebarRight > menu.viewport - 8 ||
    menu.sidebarWidth > 380 ||
    !menu.closeVisible
  ) {
    throw new Error(`mobile menu drawer failed: ${JSON.stringify(menu)}`);
  }
  await page.keyboard.press("Escape");
  const closed = await page.evaluate(() => ({
    bodyOpen: document.body.classList.contains("nav-open"),
    sidebarOpen: document.querySelector(".sidebar")?.classList.contains("open"),
    ariaExpanded: document.querySelector("[data-nav-toggle]")?.getAttribute("aria-expanded"),
  }));
  if (closed.bodyOpen || closed.sidebarOpen || closed.ariaExpanded !== "false") {
    throw new Error(`mobile menu did not close on Escape: ${JSON.stringify(closed)}`);
  }
  await page.goto(`${base}/channels/discord`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(artifacts, "discord-mobile-dark.png"), fullPage: true });
  const discordOverflow = await page.evaluate(() => {
    const viewport = innerWidth;
    const longCode = [...document.querySelectorAll(".doc code")].find((node) =>
      node.textContent?.includes("voice.realtime.providers.openai.interruptResponseOnInputAudio"),
    );
    const longCodeRects = [...(longCode?.getClientRects() ?? [])].map((rect) => ({
      left: rect.left,
      right: rect.right,
    }));
    const escaping = [...document.querySelectorAll(".oc-table-wrap,.oc-code,.doc pre")]
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          className: node.className,
          tagName: node.tagName,
          left: rect.left,
          right: rect.right,
        };
      })
      .filter((rect) => rect.left < -1 || rect.right > viewport + 1);
    return {
      viewport,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      longCodeFound: Boolean(longCode),
      longCodeFits:
        longCodeRects.length > 0 &&
        longCodeRects.every((rect) => rect.left >= -1 && rect.right <= viewport + 1),
      escaping,
    };
  });
  if (
    discordOverflow.documentWidth > discordOverflow.viewport + 1 ||
    discordOverflow.bodyWidth > discordOverflow.viewport + 1 ||
    !discordOverflow.longCodeFound ||
    !discordOverflow.longCodeFits ||
    discordOverflow.escaping.length
  ) {
    throw new Error(`discord mobile overflow failed: ${JSON.stringify(discordOverflow)}`);
  }
  await page.close();
}

async function checkAmbientCodePage() {
  const page = await browser.newPage({ viewport: { width: 1496, height: 760 } });
  await page.goto(`${base}/channels/ambient-room-events`, { waitUntil: "networkidle" });
  await page.locator(".oc-code").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifacts, "ambient-code-dark.png"), fullPage: false });
  const code = await page.evaluate(() => {
    const figure = document.querySelector(".oc-code");
    const button = figure?.querySelector("[data-code-copy]");
    const label = figure?.querySelector(".oc-code-label");
    const attr = figure?.querySelector(".hljs-attr");
    const string = figure?.querySelector(".hljs-string");
    const lines = [...(figure?.querySelectorAll(".code-line") ?? [])].slice(0, 5);
    const rects = lines.map((line) => line.getBoundingClientRect());
    const buttonRect = button?.getBoundingClientRect();
    const buttonStyle = button ? getComputedStyle(button) : null;
    const buttonBefore = button ? getComputedStyle(button, "::before") : null;
    const buttonAfter = button ? getComputedStyle(button, "::after") : null;
    const labelStyle = label ? getComputedStyle(label) : null;
    const iconLeft =
      buttonBefore && buttonAfter
        ? Math.min(parseFloat(buttonBefore.left), parseFloat(buttonAfter.left))
        : 0;
    const iconTop =
      buttonBefore && buttonAfter
        ? Math.min(parseFloat(buttonBefore.top), parseFloat(buttonAfter.top))
        : 0;
    const iconRight =
      buttonBefore && buttonAfter
        ? Math.max(
            parseFloat(buttonBefore.left) + parseFloat(buttonBefore.width),
            parseFloat(buttonAfter.left) + parseFloat(buttonAfter.width),
          )
        : 0;
    const iconBottom =
      buttonBefore && buttonAfter
        ? Math.max(
            parseFloat(buttonBefore.top) + parseFloat(buttonBefore.height),
            parseFloat(buttonAfter.top) + parseFloat(buttonAfter.height),
          )
        : 0;
    return {
      lineCount: figure?.querySelectorAll(".code-line").length ?? 0,
      lineDisplay: lines.map((line) => getComputedStyle(line).display),
      lineWhiteSpace: lines.map((line) => getComputedStyle(line).whiteSpace),
      linesStacked: rects.every((rect, index) => index === 0 || rect.top > rects[index - 1].top),
      attrColor: attr ? getComputedStyle(attr).color : "",
      stringColor: string ? getComputedStyle(string).color : "",
      buttonWidth: buttonRect?.width ?? 0,
      buttonHeight: buttonRect?.height ?? 0,
      buttonText: button?.textContent?.trim(),
      buttonColor: buttonStyle?.color,
      iconInsetX: Math.round(Math.abs(iconLeft - ((buttonRect?.width ?? 0) - iconRight))),
      iconInsetY: Math.round(Math.abs(iconTop - ((buttonRect?.height ?? 0) - iconBottom))),
      labelTransform: labelStyle?.textTransform,
    };
  });
  if (
    code.lineCount < 9 ||
    !code.lineDisplay.every((display) => display === "block") ||
    !code.lineWhiteSpace.every((space) => space === "pre") ||
    !code.linesStacked ||
    code.attrColor === code.stringColor ||
    code.buttonWidth < 30 ||
    code.buttonWidth > 34 ||
    code.buttonHeight < 28 ||
    code.iconInsetX > 2 ||
    code.iconInsetY > 2 ||
    code.buttonText !== "Copy code" ||
    code.labelTransform !== "uppercase"
  ) {
    throw new Error(`ambient code block visual failed: ${JSON.stringify(code)}`);
  }
  await page.evaluate(() => {
    window.__ocClipboardWrites = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => window.__ocClipboardWrites.push(text) },
    });
  });
  await page.click(".oc-code [data-code-copy]");
  const copied = await page.evaluate(() => ({
    state: document.querySelector(".oc-code [data-code-copy]")?.dataset.copyState,
    text: window.__ocClipboardWrites?.[0] ?? "",
  }));
  if (copied.state !== "copied" || !copied.text.includes('unmentionedInbound: "room_event"')) {
    throw new Error(`ambient code copy state failed: ${JSON.stringify(copied)}`);
  }
  await page.close();
}

async function checkLightMode() {
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  await page.addInitScript(() => localStorage.setItem("theme", "light"));
  await page.goto(`${base}/__elements`, { waitUntil: "networkidle" });
  await page.screenshot({
    path: path.join(artifacts, "elements-desktop-light.png"),
    fullPage: true,
  });
  const skin = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const code = getComputedStyle(document.querySelector(".oc-code"));
    const badge = getComputedStyle(document.querySelector(".oc-badge"));
    const cardWidths = [...document.querySelectorAll(".oc-card")].map(
      (card) => card.getBoundingClientRect().width,
    );
    return {
      theme: document.documentElement.dataset.theme,
      codeBg: code.backgroundColor,
      badgeRadius: badge.borderRadius,
      codeText: root.getPropertyValue("--code-text").trim(),
      minCardWidth: Math.min(...cardWidths),
    };
  });
  if (
    skin.theme !== "light" ||
    skin.codeText !== "#2d2926" ||
    skin.badgeRadius === "0px" ||
    skin.minCardWidth < 150
  ) {
    throw new Error(`light visual skin failed: ${JSON.stringify(skin)}`);
  }
  await page.close();
}

async function expectVisible(page, selector, label) {
  const visible = await page.locator(selector).first().isVisible();
  if (!visible) throw new Error(`missing visible ${label}: ${selector}`);
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".json")) return "application/json";
  return "text/plain; charset=utf-8";
}
