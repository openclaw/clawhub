import { afterEach, describe, expect, it } from "vitest";
import {
  createGoogleAnalytics,
  getGoogleAnalyticsPage,
  GOOGLE_ANALYTICS_ID,
} from "./googleAnalytics";

const publicInput = {
  href: "https://clawhub.ai/skills?fixture=secret#token",
  deployment: "production",
  isAuthenticated: false,
  isLoading: false,
  matches: [{ routeId: "/skills/", status: "success" }],
};

afterEach(() => {
  document.head.innerHTML = "";
});

describe("GA4 public navigation policy", () => {
  it("uses fixed public fields without query, fragment, title, or referrer inputs", () => {
    expect(getGoogleAnalyticsPage(publicInput)).toEqual({
      page_location: "https://clawhub.ai/skills",
      page_title: "Skills - ClawHub",
      page_referrer: "",
    });
  });

  it.each([
    "https://www.clawhub.ai/skills",
    "https://clawhub.com/skills",
    "https://hub.openclaw.ai/skills",
    "https://docs.clawhub.ai/skills",
    "https://clawhub.ai.example.com/skills",
    "http://clawhub.ai/skills",
    "https://clawhub.ai:444/skills",
    "http://localhost:3000/skills",
  ])("excludes noncanonical origin %s", (href) => {
    expect(getGoogleAnalyticsPage({ ...publicInput, href })).toBeNull();
  });

  it.each(["preview", "development", "test", "staging", undefined])(
    "excludes deployment %s",
    (deployment) => {
      expect(getGoogleAnalyticsPage({ ...publicInput, deployment })).toBeNull();
    },
  );

  it("includes signed-in visitors on fixed public routes without identity fields", () => {
    expect(getGoogleAnalyticsPage({ ...publicInput, isAuthenticated: true })).toEqual(
      getGoogleAnalyticsPage(publicInput),
    );
  });

  it("excludes loading, error, and unknown pages", () => {
    expect(getGoogleAnalyticsPage({ ...publicInput, isLoading: true })).toBeNull();
    for (const status of ["pending", "error", "notFound"]) {
      expect(
        getGoogleAnalyticsPage({ ...publicInput, matches: [{ routeId: "/skills/", status }] }),
      ).toBeNull();
    }
    expect(
      getGoogleAnalyticsPage({
        ...publicInput,
        matches: [{ routeId: "/skills/", status: "success", globalNotFound: true }],
      }),
    ).toBeNull();
    expect(getGoogleAnalyticsPage({ ...publicInput, matches: [] })).toBeNull();
  });

  it.each([
    "/admin",
    "/management",
    "/dashboard",
    "/settings",
    "/stars",
    "/auth/docs",
    "/cli/auth",
    "/cli/device",
    "/upload",
    "/import",
    "/user/$handle",
    "/u/$handle",
    "/p/$handle",
    "/orgs/$handle",
    "/users/",
    "/$owner/skills/$slug/settings",
    "/new-public-route",
  ])("fails closed for %s", (routeId) => {
    expect(
      getGoogleAnalyticsPage({ ...publicInput, matches: [{ routeId, status: "success" }] }),
    ).toBeNull();
  });

  it("counts verified public resources for signed-in visitors without visitor identity", () => {
    const skillMatch = {
      routeId: "/$owner/skills/$slug",
      status: "success",
      loaderData: {
        initialData: {
          result: { skill: { displayName: "private-looking title" }, latestVersion: {} },
        },
      },
    };
    expect(getGoogleAnalyticsPage({ ...publicInput, matches: [skillMatch] })?.page_location).toBe(
      "https://clawhub.ai/skills",
    );
    expect(
      getGoogleAnalyticsPage({ ...publicInput, isAuthenticated: true, matches: [skillMatch] }),
    ).toEqual(getGoogleAnalyticsPage({ ...publicInput, matches: [skillMatch] }));
    expect(
      getGoogleAnalyticsPage({ ...publicInput, matches: [{ ...skillMatch, loaderData: null }] }),
    ).toBeNull();
    for (const field of ["isPendingScan", "isHiddenByMod", "isRemoved", "isMalwareBlocked"]) {
      const loaderData = {
        initialData: {
          result: { skill: {}, latestVersion: {}, moderationInfo: { [field]: true } },
        },
      };
      expect(
        getGoogleAnalyticsPage({ ...publicInput, matches: [{ ...skillMatch, loaderData }] }),
      ).toBeNull();
    }
    const pluginMatch = { routeId: "/$owner/plugins/$slug", status: "success" };
    for (const channel of ["official", "community"]) {
      expect(
        getGoogleAnalyticsPage({
          ...publicInput,
          matches: [{ ...pluginMatch, loaderData: { detail: { package: { channel } } } }],
        })?.page_title,
      ).toBe("Plugin - ClawHub");
    }
    expect(
      getGoogleAnalyticsPage({
        ...publicInput,
        matches: [{ ...pluginMatch, loaderData: { detail: { package: { channel: "private" } } } }],
      }),
    ).toBeNull();
  });
  it("preserves only safe public attribution and search fields", () => {
    const result = getGoogleAnalyticsPage({
      ...publicInput,
      href: "https://clawhub.ai/search?q=calendar+automation&utm_source=chatgpt&utm_campaign=visitor%40example.test#private-fragment",
      matches: [{ routeId: "/search", status: "success" }],
      referrer: "https://chatgpt.com/c/private-chat?token=private",
    });
    expect(result).toMatchObject({
      page_location: "https://clawhub.ai/search?q=calendar+automation&utm_source=chatgpt",
      page_referrer: "https://chatgpt.com/",
    });
    for (const key of ["code", "token", "state", "return_to", "auth_retry", "error_description"])
      expect(
        getGoogleAnalyticsPage({ ...publicInput, href: `https://clawhub.ai/skills?${key}=secret` }),
      ).toBeNull();
    expect(
      getGoogleAnalyticsPage({
        ...publicInput,
        href: "https://clawhub.ai/skills?q=user@example.test",
      }),
    ).toBeNull();
    expect(getGoogleAnalyticsPage({ ...publicInput, collectionAllowed: false })).toBeNull();
  });
  it("accepts authoritative public identities and rejects hidden or unresolved catalog data", () => {
    const skill = (result: unknown) =>
      getGoogleAnalyticsPage({
        ...publicInput,
        matches: [
          {
            routeId: "/$owner/skills/$slug",
            status: "success",
            loaderData: { initialData: { result } },
          },
        ],
      });
    expect(
      skill({ skill: { _id: "public-id", installKind: "github", moderationStatus: "active" } })
        ?.content_id,
    ).toBe("skill:public-id");
    for (const result of [
      null,
      { skill: {} },
      { skill: { softDeletedAt: 1 }, latestVersion: {} },
      { skill: { moderationStatus: "hidden" }, latestVersion: {} },
      { skill: {}, latestVersion: {}, pendingReview: true },
    ])
      expect(skill(result)).toBeNull();
    expect(
      getGoogleAnalyticsPage({
        ...publicInput,
        matches: [
          {
            routeId: "/$owner/plugins/$slug",
            status: "success",
            loaderData: { detail: { package: { name: "@public/plugin", channel: "official" } } },
          },
        ],
      })?.content_id,
    ).toBe("plugin:@public/plugin");
    expect(
      getGoogleAnalyticsPage({
        ...publicInput,
        matches: [
          {
            routeId: "/skills-sh/$owner/$repo/$slug",
            status: "success",
            loaderData: { externalId: "public/skill" },
          },
        ],
      })?.content_id,
    ).toBe("catalog_skill:public/skill");
    expect(
      getGoogleAnalyticsPage({
        ...publicInput,
        matches: [{ routeId: "/skills-sh/$owner/$repo/$slug", status: "success" }],
      }),
    ).toBeNull();
  });
});

describe("native Google tag", () => {
  function fixture(now?: () => number) {
    const browser = {
      document,
      dataLayer: [] as unknown[],
      "ga-disable-G-3SK7X2YLSJ": false,
    } as unknown as Window & {
      dataLayer: IArguments[];
      gtag?: (...args: unknown[]) => void;
      "ga-disable-G-3SK7X2YLSJ": boolean;
    };
    const tracker = createGoogleAnalytics("request-nonce", browser, now);
    const events = () =>
      browser.dataLayer
        .map((entry) => Array.from(entry))
        .filter(([command]) => command === "event");
    return { browser, tracker, events };
  }

  it("loads one nonce-bearing SDK and sends exactly one pageview per committed pathname", () => {
    const { browser, tracker, events } = fixture();
    const page = getGoogleAnalyticsPage(publicInput);
    tracker.update(page, "/skills");
    tracker.update(page, "/skills");
    tracker.pause();
    tracker.update(page, "/skills");
    expect(events()).toHaveLength(1);
    expect(browser["ga-disable-G-3SK7X2YLSJ"]).toBe(false);
    const script = document.querySelector("script")!;
    expect(script.src).toBe(`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_ID}`);
    expect(script.nonce).toBe("request-nonce");
    expect(script.referrerPolicy).toBe("no-referrer");
    expect(document.querySelectorAll("script")).toHaveLength(1);
    const config = browser.dataLayer
      .map((entry) => Array.from(entry))
      .find(([command]) => command === "config");
    expect(config?.[2]).toMatchObject({
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    expect(events()[0]).toEqual(["event", "page_view", { ...page, send_to: GOOGLE_ANALYTICS_ID }]);
  });

  it("pauses immediately before unknown/private routes and counts the public return", () => {
    const { browser, tracker, events } = fixture();
    const page = getGoogleAnalyticsPage(publicInput);
    tracker.update(page, "/skills");
    tracker.pause();
    expect(browser["ga-disable-G-3SK7X2YLSJ"]).toBe(true);
    tracker.update(null, "/settings");
    expect(events()).toHaveLength(1);
    tracker.update(page, "/skills");
    expect(events()).toHaveLength(2);
  });

  it("updates persistent native page fields without pinning them in repeated config", () => {
    const { browser, tracker } = fixture();
    tracker.update(getGoogleAnalyticsPage(publicInput), "/skills");
    const next = {
      page_location: "https://clawhub.ai/plugins",
      page_title: "Plugins - ClawHub",
      page_referrer: "https://chatgpt.com/",
    };
    tracker.pause();
    tracker.update(next, "/plugins");
    const calls = browser.dataLayer.map((entry) => Array.from(entry));
    const configs = calls.filter(([kind]) => kind === "config");
    expect(configs).toHaveLength(1);
    expect(configs[0][2]).not.toHaveProperty("page_location");
    expect(calls.filter(([kind]) => kind === "set").at(-1)).toEqual(["set", next]);
  });

  it("keeps async workflow outcomes in their original fixed context across public navigation", () => {
    const { tracker, events } = fixture();
    tracker.update(null, "/skills/publish", { collectionAllowed: true, consentEpoch: "a" });
    const operation = tracker.captureOperation("skill_publish")!;
    tracker.update(getGoogleAnalyticsPage(publicInput), "/skills", { consentEpoch: "a" });
    expect(
      operation.send({
        name: "resource_action",
        params: {
          action: "publish",
          action_result: "accepted",
          content_type: "skill",
          content_id: "must-not-send",
        },
      }),
    ).toBe(true);
    expect(events().at(-1)?.[2]).toMatchObject({
      page_location: "https://clawhub.ai/_analytics/workflows/skill-publish",
      ui_location: "skill_publish",
      event_deferred: 1,
    });
    expect(events().at(-1)?.[2]).not.toHaveProperty("content_id");
    expect(
      operation.send({
        name: "copy_action",
        params: { content_type: "skill", action_result: "success", ui_location: "publish" },
      }),
    ).toBe(false);
  });

  it("rejects async workflow outcomes after withdrawal even if the same epoch is reused", () => {
    const { tracker, events } = fixture();
    tracker.update(null, "/plugins/publish", { collectionAllowed: true, consentEpoch: "a" });
    const operation = tracker.captureOperation("plugin_publish")!;
    tracker.optOut();
    tracker.update(getGoogleAnalyticsPage(publicInput), "/skills", { consentEpoch: "a" });
    expect(
      operation.send({
        name: "resource_action",
        params: { action: "publish", content_type: "plugin", action_result: "accepted" },
      }),
    ).toBe(false);
    expect(events().filter((event) => event[1] === "resource_action")).toHaveLength(0);
  });

  it("preserves the counted public navigation while authentication resolves", () => {
    const { browser, tracker, events } = fixture();
    tracker.update(getGoogleAnalyticsPage(publicInput), "/skills");
    tracker.update(getGoogleAnalyticsPage({ ...publicInput, isLoading: true }), "/skills");
    expect(browser["ga-disable-G-3SK7X2YLSJ"]).toBe(true);
    expect(events()).toHaveLength(1);

    tracker.update(getGoogleAnalyticsPage({ ...publicInput, isAuthenticated: true }), "/skills");
    expect(browser["ga-disable-G-3SK7X2YLSJ"]).toBe(false);
    expect(events()).toHaveLength(1);
  });

  it("does not count a return after an uncommitted departure", () => {
    const { browser, tracker, events } = fixture();
    const page = getGoogleAnalyticsPage(publicInput);
    tracker.update(page, "/skills");
    tracker.update(null, "/settings", { navigationPending: true });
    expect(browser["ga-disable-G-3SK7X2YLSJ"]).toBe(true);
    tracker.update(page, "/skills");
    expect(events()).toHaveLength(1);
  });

  it("counts a committed public return once after an excluded page, even if auth is loading", () => {
    const { browser, tracker, events } = fixture();
    const page = getGoogleAnalyticsPage(publicInput);
    tracker.update(page, "/skills");
    tracker.update(null, "/settings");
    tracker.update(null, "/skills");
    expect(browser["ga-disable-G-3SK7X2YLSJ"]).toBe(true);
    expect(events()).toHaveLength(1);
    tracker.update(page, "/skills");
    tracker.update(page, "/skills");
    expect(events()).toHaveLength(2);
  });

  it("counts distinct public items even when they share the same safe template", () => {
    const { tracker, events } = fixture();
    const page = {
      page_location: "https://clawhub.ai/:publisher/skills/:skill",
      page_title: "Skill - ClawHub",
      page_referrer: "",
    };
    tracker.update(page, "/alice/skills/a");
    tracker.update(page, "/bob/skills/b");
    expect(events()).toHaveLength(2);
  });

  it("does not load a tag on excluded pages or without a CSP nonce", () => {
    const { browser, tracker } = fixture();
    tracker.update(null, "/admin");
    createGoogleAnalytics("", browser).update(getGoogleAnalyticsPage(publicInput), "/skills");
    expect(browser.dataLayer).toEqual([]);
    expect(document.querySelector("script")).toBeNull();
  });

  it("fails closed if another Google tag owner already exists", () => {
    const { browser, tracker } = fixture();
    browser.gtag = () => undefined;
    tracker.update(getGoogleAnalyticsPage(publicInput), "/skills");
    expect(browser["ga-disable-G-3SK7X2YLSJ"]).toBe(true);
    expect(browser.dataLayer).toEqual([]);
  });
  it("does not load over an existing tag element or over-emit client errors", () => {
    const { tracker, events } = fixture();
    const script = document.createElement("script");
    script.src = "https://www.googletagmanager.com/gtag/js?id=other";
    document.head.appendChild(script);
    tracker.update(getGoogleAnalyticsPage(publicInput), "/skills");
    expect(events()).toHaveLength(0);
    script.remove();
    tracker.update(getGoogleAnalyticsPage(publicInput), "/skills");
    for (let i = 0; i < 5; i++)
      tracker.track({
        name: "client_error",
        params: { error_type: "runtime", error_code: "uncaught" },
      });
    expect(events().filter((e) => e[1] === "client_error")).toHaveLength(3);
  });
  it("permits only the matching fixed workflow outcome and drops stale queued items on capture", () => {
    let time = 0;
    const { tracker, events } = fixture(() => time);
    tracker.update(null, "/plugins/publish", { collectionAllowed: true, consentEpoch: "a" });
    const operation = tracker.captureOperation("plugin_publish")!;
    expect(
      operation.send({
        name: "form_start",
        params: { form_id: "skill_report", ui_location: "detail" },
      }),
    ).toBe(false);
    expect(
      operation.send({
        name: "form_start",
        params: { form_id: "skill_publish", ui_location: "publish" },
      }),
    ).toBe(false);
    expect(
      operation.send({
        name: "popup_view",
        params: { popup_id: "promotion", ui_location: "promotion" },
      }),
    ).toBe(false);
    expect(
      operation.send({
        name: "form_validation_error",
        params: { form_id: "plugin_publish", field_name: "files", error_code: "invalid" },
      }),
    ).toBe(true);
    time = 30_001;
    operation.send({
      name: "popup_view",
      params: { popup_id: "plugin_submitted", ui_location: "publish" },
    });
    tracker.update(getGoogleAnalyticsPage(publicInput), "/skills", { consentEpoch: "a" });
    expect(events().filter((e) => e[1] === "form_validation_error")).toHaveLength(0);
    expect(events().filter((e) => e[1] === "popup_view")).toHaveLength(1);
  });

  it("uses fixed workflow context and never inherits an unrelated public resource", () => {
    const { tracker, events } = fixture();
    tracker.update(null, "/skills/publish", { collectionAllowed: true, consentEpoch: "a" });
    tracker.track({
      name: "resource_action",
      params: {
        action: "publish",
        action_result: "accepted",
        content_type: "skill",
        content_id: "private-id-must-not-leave",
      },
    });
    expect(events()).toHaveLength(0);
    tracker.update(
      { ...getGoogleAnalyticsPage(publicInput)!, content_id: "unrelated-public-item" },
      "/skills",
      { consentEpoch: "a" },
    );
    expect(events()).toHaveLength(2);
    expect(events()[1]).toEqual([
      "event",
      "resource_action",
      expect.objectContaining({
        page_location: "https://clawhub.ai/_analytics/workflows/skill-publish",
        page_title: "Skill publishing workflow",
        page_referrer: "",
        ui_location: "skill_publish",
        event_deferred: 1,
        action_result: "accepted",
      }),
    ]);
    expect(events()[1][2]).not.toHaveProperty("content_id");
    expect(events().filter((event) => event[1] === "page_view")).toHaveLength(1);
  });

  it("drops denied, expired, and prior-epoch workflow outcomes", () => {
    let time = 100;
    const { tracker, events } = fixture(() => time);
    const outcome = { name: "login", params: { method: "github" } } as const;
    tracker.track(outcome);
    tracker.update(null, "/auth/docs", { collectionAllowed: true, consentEpoch: "a" });
    tracker.track(outcome);
    time += 30_001;
    tracker.update(getGoogleAnalyticsPage(publicInput), "/skills", { consentEpoch: "a" });
    expect(events().filter((event) => event[1] === "login")).toHaveLength(0);
    tracker.update(null, "/auth/docs", { collectionAllowed: true, consentEpoch: "a" });
    tracker.track(outcome);
    tracker.update(getGoogleAnalyticsPage(publicInput), "/skills", { consentEpoch: "b" });
    tracker.optOut();
    tracker.track(outcome);
    tracker.update(getGoogleAnalyticsPage(publicInput), "/skills", { consentEpoch: "c" });
    expect(events().filter((event) => event[1] === "login")).toHaveLength(0);
  });

  it("bounds the memory queue to eight and excludes other private actions", () => {
    const { tracker, events } = fixture();
    tracker.update(null, "/plugins/publish", { collectionAllowed: true, consentEpoch: "a" });
    for (let index = 0; index < 12; index++)
      tracker.track({
        name: "form_attempt",
        params: { form_id: "plugin_publish", ui_location: "publish" },
      });
    tracker.track({
      name: "resource_action",
      params: {
        action: "star",
        content_type: "skill",
        action_result: "success",
        content_id: "private-resource",
      },
    });
    tracker.update(getGoogleAnalyticsPage(publicInput), "/skills", { consentEpoch: "a" });
    expect(events().filter((event) => event[1] === "form_attempt")).toHaveLength(8);
    expect(events().filter((event) => event[1] === "resource_action")).toHaveLength(0);
  });

  it("counts a restored navigation once without turning ordinary updates into views", () => {
    const { tracker, events } = fixture();
    const page = getGoogleAnalyticsPage(publicInput);
    tracker.update(page, "/skills");
    tracker.update(page, "/skills");
    tracker.cacheNavigation("/skills");
    tracker.restoreNavigation();
    tracker.update(page, "/skills");
    tracker.update(page, "/skills");
    expect(events()).toHaveLength(2);
  });

  it("dedupes first grant around restore when the cached document never counted a view", () => {
    const { tracker, events } = fixture();
    const page = getGoogleAnalyticsPage(publicInput);
    tracker.update(null, "/skills", { collectionAllowed: false });
    tracker.cacheNavigation("/skills");
    expect(events()).toHaveLength(0);
    // A queued storage notification can be delivered before trusted pageshow.
    tracker.update(page, "/skills", { collectionAllowed: true, consentEpoch: "a" });
    tracker.restoreNavigation();
    tracker.update(page, "/skills", { collectionAllowed: true, consentEpoch: "a" });
    tracker.update(page, "/skills", { collectionAllowed: true, consentEpoch: "a" });
    expect(events()).toHaveLength(1);
  });

  it("counts the current return after a real denied departure without replaying denied views", () => {
    const { tracker, events } = fixture();
    const page = getGoogleAnalyticsPage(publicInput);
    tracker.update(page, "/skills", { consentEpoch: "a" });
    tracker.update(null, "/skills", { collectionAllowed: false });
    tracker.update(page, "/skills", { consentEpoch: "b" });
    expect(events()).toHaveLength(1);
    tracker.update(null, "/settings", { collectionAllowed: false });
    tracker.update(null, "/skills", { collectionAllowed: false });
    expect(events()).toHaveLength(1);
    tracker.update(page, "/skills", { consentEpoch: "c" });
    expect(events()).toHaveLength(2);
  });
});
