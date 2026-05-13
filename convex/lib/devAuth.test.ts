import { describe, expect, it } from "vitest";
import { isLocalDevAuthEnabled } from "./devAuth";

describe("isLocalDevAuthEnabled", () => {
  it("requires the explicit dev auth flag", () => {
    expect(
      isLocalDevAuthEnabled({
        CONVEX_DEPLOYMENT: "local:clawhub",
        CONVEX_SITE_URL: "http://127.0.0.1:3211",
      }),
    ).toBe(false);
  });

  it("allows local Convex deployments", () => {
    expect(
      isLocalDevAuthEnabled({
        CONVEX_SITE_URL: "http://127.0.0.1:3211",
        DEV_AUTH_ENABLED: "1",
        CONVEX_DEPLOYMENT: "local:clawhub",
      }),
    ).toBe(true);
  });

  it("allows anonymous local Convex deployments", () => {
    expect(
      isLocalDevAuthEnabled({
        CONVEX_SITE_URL: "http://127.0.0.1:3211",
        DEV_AUTH_ENABLED: "1",
        CONVEX_DEPLOYMENT: "anonymous:clawhub",
      }),
    ).toBe(true);
  });

  it("allows the test runner deployment marker when Convex does not expose deployment name", () => {
    expect(
      isLocalDevAuthEnabled({
        CONVEX_SITE_URL: "http://127.0.0.1:3211",
        DEV_AUTH_CONVEX_DEPLOYMENT: "local:clawhub",
        DEV_AUTH_ENABLED: "1",
      }),
    ).toBe(true);
  });

  it("rejects cloud dev deployments even when the dev auth flag is set", () => {
    expect(
      isLocalDevAuthEnabled({
        CONVEX_SITE_URL: "http://127.0.0.1:3211",
        DEV_AUTH_ENABLED: "1",
        CONVEX_DEPLOYMENT: "dev:clever-rabbit-123",
      }),
    ).toBe(false);
  });

  it("rejects localhost site URLs without a local deployment marker", () => {
    expect(
      isLocalDevAuthEnabled({
        CONVEX_SITE_URL: "http://127.0.0.1:3211",
        DEV_AUTH_ENABLED: "1",
      }),
    ).toBe(false);
  });

  it("rejects local deployment markers without localhost Convex site URLs", () => {
    expect(
      isLocalDevAuthEnabled({
        CONVEX_DEPLOYMENT: "local:clawhub",
        CONVEX_SITE_URL: "https://clawhub.ai",
        DEV_AUTH_ENABLED: "1",
      }),
    ).toBe(false);
  });

  it("does not allow the test runner marker to override a cloud deployment", () => {
    expect(
      isLocalDevAuthEnabled({
        CONVEX_DEPLOYMENT: "dev:clever-rabbit-123",
        CONVEX_SITE_URL: "http://127.0.0.1:3211",
        DEV_AUTH_CONVEX_DEPLOYMENT: "local:clawhub",
        DEV_AUTH_ENABLED: "1",
      }),
    ).toBe(false);
  });

  it("rejects production deployments", () => {
    expect(
      isLocalDevAuthEnabled({
        CONVEX_SITE_URL: "http://127.0.0.1:3211",
        DEV_AUTH_ENABLED: "1",
        CONVEX_DEPLOYMENT: "prod:wry-manatee-359",
      }),
    ).toBe(false);
  });
});
