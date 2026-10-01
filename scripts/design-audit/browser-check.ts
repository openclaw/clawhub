import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type BrowserContext } from "@playwright/test";

type BrowserEvidence = {
  route: string;
  theme: "dark" | "light";
  viewport: "desktop" | "mobile";
  screenshot: string;
  horizontalOverflow: number;
  unnamedInteractiveElements: string[];
  pageErrors: string[];
};

const routes = ["/", "/skills", "/plugins"];
const viewports = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function setTheme(context: BrowserContext, theme: "dark" | "light") {
  await context.addInitScript((resolvedTheme) => {
    window.localStorage.setItem(
      "clawhub-theme-selection",
      JSON.stringify({ theme: "claw", mode: resolvedTheme }),
    );
    window.localStorage.setItem("clawhub-theme", resolvedTheme);
    window.localStorage.setItem("clawhub-theme-name", "claw");
    document.cookie = `clawhub-theme=${resolvedTheme}; path=/`;
  }, theme);
}

async function main() {
  const baseUrl = argument("--base-url");
  const output = argument("--output");
  const screenshotDir = argument("--screenshots");
  if (!baseUrl || !output || !screenshotDir) {
    throw new Error(
      "usage: browser-check.ts --base-url <url> --output <path> --screenshots <directory>",
    );
  }

  await mkdir(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const evidence: BrowserEvidence[] = [];

  try {
    for (const [viewportName, viewport] of Object.entries(viewports)) {
      for (const theme of ["dark", "light"] as const) {
        const context = await browser.newContext({
          colorScheme: theme,
          viewport,
        });
        await setTheme(context, theme);
        const page = await context.newPage();
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));

        for (const route of routes) {
          await page.goto(new URL(route, baseUrl).toString(), {
            waitUntil: "domcontentloaded",
            timeout: 60_000,
          });
          await page.waitForTimeout(1_500);
          const actualTheme = await page.locator("html").getAttribute("data-theme-resolved");
          if (actualTheme !== theme) {
            throw new Error(`${route} resolved ${actualTheme ?? "no theme"} instead of ${theme}`);
          }

          const routeName = route === "/" ? "home" : route.slice(1).replaceAll("/", "-");
          const screenshot = join(screenshotDir, `${routeName}-${theme}-${viewportName}.png`);
          await page.screenshot({ path: screenshot, fullPage: true });

          const pageEvidence = await page.evaluate(() => {
            const interactive = [
              ...document.querySelectorAll<HTMLElement>(
                "button, a[href], input, select, textarea, [role=button], [role=link]",
              ),
            ];
            const unnamedInteractiveElements = interactive
              .filter((element) => {
                const text = element.textContent?.trim();
                const label = element.getAttribute("aria-label")?.trim();
                const labelledBy = element.getAttribute("aria-labelledby")?.trim();
                const title = element.getAttribute("title")?.trim();
                const alt = element.querySelector("img")?.getAttribute("alt")?.trim();
                return !text && !label && !labelledBy && !title && !alt;
              })
              .slice(0, 20)
              .map((element) => {
                const id = element.id ? `#${element.id}` : "";
                const classes =
                  typeof element.className === "string" && element.className.trim()
                    ? `.${element.className.trim().split(/\s+/).slice(0, 3).join(".")}`
                    : "";
                return `${element.tagName.toLowerCase()}${id}${classes}`;
              });
            return {
              horizontalOverflow: Math.max(
                0,
                document.documentElement.scrollWidth - window.innerWidth,
              ),
              unnamedInteractiveElements,
            };
          });

          evidence.push({
            route,
            theme,
            viewport: viewportName as keyof typeof viewports,
            screenshot,
            horizontalOverflow: pageEvidence.horizontalOverflow,
            unnamedInteractiveElements: pageEvidence.unnamedInteractiveElements,
            pageErrors: [...pageErrors],
          });
          pageErrors.length = 0;
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  await writeFile(
    output,
    `${JSON.stringify(
      {
        baseUrl,
        routes,
        evidence,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`captured ${evidence.length} route/theme/viewport combinations`);
}

if (import.meta.main) {
  await main();
}
