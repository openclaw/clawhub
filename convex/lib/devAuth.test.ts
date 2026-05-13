import { describe, expect, it } from "vitest";
import { isLocalDevAuthEnabled } from "./devAuth";

describe("isLocalDevAuthEnabled", () => {
  it("requires the explicit dev auth flag", () => {
    expect(isLocalDevAuthEnabled({ CONVEX_DEPLOYMENT: "local:clawhub" })).toBe(false);
  });

  it("allows local Convex deployments", () => {
    expect(
      isLocalDevAuthEnabled({
        DEV_AUTH_ENABLED: "1",
        CONVEX_DEPLOYMENT: "local:clawhub",
      }),
    ).toBe(true);
  });

  it("allows anonymous local Convex deployments", () => {
    expect(
      isLocalDevAuthEnabled({
        DEV_AUTH_ENABLED: "1",
        CONVEX_DEPLOYMENT: "anonymous:clawhub",
      }),
    ).toBe(true);
  });

  it("allows local Convex site URLs when deployment name is not exposed to functions", () => {
    expect(
      isLocalDevAuthEnabled({
        DEV_AUTH_ENABLED: "1",
        CONVEX_SITE_URL: "http://127.0.0.1:3211",
      }),
    ).toBe(true);
  });

  it("rejects cloud dev deployments even when the dev auth flag is set", () => {
    expect(
      isLocalDevAuthEnabled({
        DEV_AUTH_ENABLED: "1",
        CONVEX_DEPLOYMENT: "dev:clever-rabbit-123",
      }),
    ).toBe(false);
  });

  it("rejects non-local Convex site URLs even when the dev auth flag is set", () => {
    expect(
      isLocalDevAuthEnabled({
        DEV_AUTH_ENABLED: "1",
        CONVEX_SITE_URL: "https://clawhub.ai",
      }),
    ).toBe(false);
  });

  it("rejects production deployments", () => {
    expect(
      isLocalDevAuthEnabled({
        DEV_AUTH_ENABLED: "1",
        CONVEX_DEPLOYMENT: "prod:wry-manatee-359",
      }),
    ).toBe(false);
  });
});
