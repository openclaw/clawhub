import { describe, expect, it } from "vitest";
import {
  analyticsEventParameters,
  analyticsExternalLinkParameters,
  analyticsPublicResourcePlacement,
  type AnalyticsEvent,
} from "./analyticsEvents";

const origin = "https://clawhub.ai";
function anchor(href: string) {
  const element = document.createElement("a");
  element.href = href;
  return element;
}
const selection = (params: Record<string, unknown>) =>
  ({
    name: "select_content",
    params: {
      content_type: "resource",
      content_id: "footer_link",
      ui_location: "footer",
      ...params,
    },
  }) as AnalyticsEvent;

describe("selection destination fields", () => {
  it("uses actual external HTTP anchors, strips query/hash in telemetry only, and derives the hostname", () => {
    const link = anchor("https://Example.test:8443/guide?utm_source=public#section");
    const href = link.href;
    const fields = analyticsExternalLinkParameters(link, origin);
    expect(fields).toEqual({
      link_url: "https://example.test:8443/guide",
      link_domain: "example.test",
    });
    expect(link.href).toBe(href);
    expect(analyticsEventParameters(selection(fields), origin)).toMatchObject(fields);
    expect(analyticsExternalLinkParameters(anchor("http://example.test/guide"), origin)).toEqual({
      link_url: "http://example.test/guide",
      link_domain: "example.test",
    });
    expect(
      analyticsExternalLinkParameters(anchor("https://docs.openclaw.ai/start"), origin),
    ).toEqual({
      link_url: "https://docs.openclaw.ai/start",
      link_domain: "docs.openclaw.ai",
    });
  });

  it("keeps destination fields absent for internal and non-anchor selections", () => {
    expect(analyticsExternalLinkParameters(anchor(`${origin}/skills?q=calendar`), origin)).toEqual(
      {},
    );
    expect(analyticsExternalLinkParameters(document.createElement("button"), origin)).toEqual({});
    expect(analyticsExternalLinkParameters(null, origin)).toEqual({});
    expect(
      analyticsEventParameters(
        selection({ link_url: `${origin}/skills`, link_domain: "clawhub.ai" }),
        origin,
      ),
    ).toEqual({ content_type: "resource", content_id: "footer_link", ui_location: "footer" });
  });

  it("rejects credentialed, private and non-HTTP destinations before stripping fields", () => {
    const credentialed = new URL("https://example.test/guide");
    credentialed.username = "fixture";
    credentialed.password = "fixture";
    for (const href of [
      credentialed.href,
      "mailto:fixture@example.test",
      "javascript:void(0)",
      "https://example.test/private/report",
      "https://example.test/settings",
      "https://example.test/guide?token=fixture",
      "https://example.test/guide#secret=fixture",
      "https://[invalid",
    ]) {
      expect(analyticsExternalLinkParameters(anchor(href), origin)).toEqual({});
      expect(
        analyticsEventParameters(
          selection({ link_url: href, link_domain: "example.test" }),
          origin,
        ),
      ).toEqual({ content_type: "resource", content_id: "footer_link", ui_location: "footer" });
    }
  });

  it("preserves a URL beyond 100 characters while retaining the old generic field bound", () => {
    const url = `https://example.test/${"safe-path-".repeat(24)}`;
    const fields = analyticsExternalLinkParameters(anchor(url), origin);
    expect(
      analyticsEventParameters(selection({ ...fields, content_id: "x".repeat(101) }), origin),
    ).toEqual({
      content_type: "resource",
      ui_location: "footer",
      link_url: url,
      link_domain: "example.test",
    });
  });

  it("omits oversized pairs instead of truncating or changing an existing selection", () => {
    const prefix = "https://example.test/";
    const atLimit = prefix + "x".repeat(1000 - prefix.length);
    expect(analyticsExternalLinkParameters(anchor(atLimit), origin)).toEqual({
      link_url: atLimit,
      link_domain: "example.test",
    });
    expect(analyticsExternalLinkParameters(anchor(`${atLimit}x`), origin)).toEqual({});
    expect(
      analyticsEventParameters(
        selection({ link_url: `${atLimit}x`, link_domain: "example.test" }),
        origin,
      ),
    ).toEqual({ content_type: "resource", content_id: "footer_link", ui_location: "footer" });
    const host = `${Array(3).fill("a".repeat(63)).join(".")}.${"b".repeat(61)}`;
    expect(host).toHaveLength(253);
    expect(analyticsExternalLinkParameters(anchor(`https://${host}/`), origin)).toEqual({
      link_url: `https://${host}/`,
      link_domain: host,
    });
    expect(analyticsExternalLinkParameters(anchor(`https://${host}x/`), origin)).toEqual({});
  });

  it("does not accept a partial/mismatched pair or attach it to another event family", () => {
    const fields = { link_url: "https://example.test/guide", link_domain: "example.test" };
    for (const params of [
      { link_url: fields.link_url },
      { link_domain: fields.link_domain },
      { ...fields, link_domain: "other.test" },
    ])
      expect(analyticsEventParameters(selection(params), origin)).toEqual({
        content_type: "resource",
        content_id: "footer_link",
        ui_location: "footer",
      });
    expect(analyticsEventParameters(selection(fields))).toEqual({
      content_type: "resource",
      content_id: "footer_link",
      ui_location: "footer",
    });
    expect(
      analyticsEventParameters(
        {
          name: "popup_view",
          params: { popup_id: "promotion", ui_location: "promotion", ...fields },
        } as AnalyticsEvent,
        origin,
      ),
    ).toEqual({ popup_id: "promotion", ui_location: "promotion" });
  });
});

describe("fixed public resource placements", () => {
  it("uses only app-owned content markers and footer structure, never arbitrary text/classes", () => {
    const footer = document.createElement("footer");
    const link = anchor("https://example.test/");
    footer.append(link);
    expect(analyticsPublicResourcePlacement(link)).toBe("footer");
    const content = document.createElement("section");
    content.setAttribute("data-analytics-public-detail", "");
    content.append(footer);
    expect(analyticsPublicResourcePlacement(link)).toBe("detail");
    const unknown = document.createElement("div");
    unknown.className = "footer private-profile visitor-value";
    unknown.append(link);
    expect(analyticsPublicResourcePlacement(link)).toBeNull();
  });
  it.each(["dialog", "menu", "listbox"])(
    "excludes %s even within a public content marker",
    (role) => {
      const content = document.createElement("div");
      content.setAttribute("data-analytics-public-detail", "");
      const overlay = document.createElement("div");
      overlay.setAttribute("role", role);
      const link = anchor("https://example.test/");
      content.append(overlay);
      overlay.append(link);
      expect(analyticsPublicResourcePlacement(link)).toBeNull();
    },
  );
  it("excludes native dialogs, modal containers, and already-owned gestures", () => {
    for (const wrapper of [
      document.createElement("dialog"),
      document.createElement("div"),
      document.createElement("footer"),
    ]) {
      wrapper.setAttribute("data-analytics-public-detail", "");
      const link = anchor("https://example.test/");
      if (wrapper.tagName === "DIV") wrapper.setAttribute("aria-modal", "true");
      if (wrapper.tagName === "FOOTER")
        link.setAttribute("data-analytics-selection-owner", "promotion");
      wrapper.append(link);
      expect(analyticsPublicResourcePlacement(link)).toBeNull();
    }
  });
});
