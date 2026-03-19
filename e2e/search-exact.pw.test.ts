import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors } from "./helpers/runtimeErrors";

test("skills search paginates exact results", async ({ page }) => {
  const errors = trackRuntimeErrors(page);
  await page.addInitScript(() => {
    const makeSearchResults = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        score: 0.9,
        skill: {
          _id: `skill_${index}`,
          slug: `skill-${index}`,
          displayName: `Skill ${index}`,
          summary: `Summary ${index}`,
          tags: {},
          stats: {
            downloads: 0,
            installsCurrent: 0,
            installsAllTime: 0,
            stars: 0,
            versions: 1,
            comments: 0,
          },
          createdAt: 0,
          updatedAt: 0,
        },
        version: null,
      }));

    class MockWebSocket {
      url: string;
      readyState = 0;
      onopen?: () => void;
      onmessage?: (event: { data: string }) => void;
      onclose?: (event: { code: number; reason: string }) => void;
      onerror?: () => void;

      constructor(url: string) {
        this.url = url;
        window.setTimeout(() => {
          this.readyState = 1;
          this.onopen?.();
        }, 0);
      }

      send(data: string) {
        try {
          const message = JSON.parse(data) as {
            type?: string;
            requestId?: number;
            udfPath?: string;
            args?: Array<Record<string, unknown>>;
          };
          if (message.type === "Action" && message.udfPath?.includes("searchSkills")) {
            const [args] = message.args ?? [];
            const limit = typeof args?.limit === "number" ? args.limit : 10;
            const limits = (window as typeof window & { __searchLimits: number[] }).__searchLimits;
            limits.push(limit);
            const response = {
              type: "ActionResponse",
              requestId: message.requestId,
              success: true,
              result: makeSearchResults(limit),
              logLines: [],
            };
            window.setTimeout(() => {
              this.onmessage?.({ data: JSON.stringify(response) });
            }, 0);
          }
        } catch {
          this.onerror?.();
        }
      }

      close(code = 1000, reason = "closed") {
        this.readyState = 3;
        this.onclose?.({ code, reason });
      }
    }

    (window as typeof window & { __searchLimits: number[] }).__searchLimits = [];
    window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  await page.goto("/skills", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Skills" })).toBeVisible();

  const input = page.getByPlaceholder("Filter by name, slug, or summary…");
  await input.fill("remind");
  await expect(page.getByText("Skill 0")).toBeVisible();
  await expect(page.getByText("Scroll to load more")).toBeVisible();

  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as typeof window & { __searchLimits: number[] }).__searchLimits.length,
        ),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
  const initialLimit = await page.evaluate(
    () => (window as typeof window & { __searchLimits: number[] }).__searchLimits[0] ?? 0,
  );
  expect(initialLimit).toBeGreaterThan(0);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByText(`Skill ${initialLimit + 5}`)).toBeVisible();
  const limits = await page.evaluate(
    () => (window as typeof window & { __searchLimits: number[] }).__searchLimits,
  );
  expect(Math.max(...limits)).toBeGreaterThan(initialLimit);
  await expectHealthyPage(page, errors);
});
