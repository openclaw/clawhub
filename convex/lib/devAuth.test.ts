import { describe, expect, it } from "vitest";
import { isLocalDevAuthEnabled } from "./devAuth";

const CLOUD_DEV_AUTH_SECRET = "dev-auth-secret-with-enough-entropy-123";

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

  it("allows cloud dev deployments with an explicit localhost site and matching secret", () => {
    expect(
      isLocalDevAuthEnabled(
        {
          CONVEX_SITE_URL: "https://clever-rabbit-123.convex.cloud",
          DEV_AUTH_CONVEX_DEPLOYMENT: "dev:clever-rabbit-123",
          DEV_AUTH_ENABLED: "1",
          DEV_AUTH_SECRET: CLOUD_DEV_AUTH_SECRET,
          DEV_AUTH_SITE_URL: "http://127.0.0.1:3211",
        },
        CLOUD_DEV_AUTH_SECRET,
      ),
    ).toBe(true);
  });

  it("allows cloud dev deployments from the fallback marker when Convex deployment is blank", () => {
    expect(
      isLocalDevAuthEnabled(
        {
          CONVEX_DEPLOYMENT: "",
          CONVEX_SITE_URL: "https://clever-rabbit-123.convex.cloud",
          DEV_AUTH_CONVEX_DEPLOYMENT: "dev:clever-rabbit-123",
          DEV_AUTH_ENABLED: "1",
          DEV_AUTH_SECRET: CLOUD_DEV_AUTH_SECRET,
          DEV_AUTH_SITE_URL: "http://127.0.0.1:3211",
        },
        CLOUD_DEV_AUTH_SECRET,
      ),
    ).toBe(true);
  });

  it("rejects cloud dev deployments when the secret is missing", () => {
    expect(
      isLocalDevAuthEnabled({
        CONVEX_SITE_URL: "https://clever-rabbit-123.convex.cloud",
        DEV_AUTH_CONVEX_DEPLOYMENT: "dev:clever-rabbit-123",
        DEV_AUTH_ENABLED: "1",
        DEV_AUTH_SECRET: CLOUD_DEV_AUTH_SECRET,
        DEV_AUTH_SITE_URL: "http://127.0.0.1:3211",
      }),
    ).toBe(false);
  });

  it("rejects cloud dev deployments when the configured secret is too short", () => {
    expect(
      isLocalDevAuthEnabled(
        {
          CONVEX_SITE_URL: "https://clever-rabbit-123.convex.cloud",
          DEV_AUTH_CONVEX_DEPLOYMENT: "dev:clever-rabbit-123",
          DEV_AUTH_ENABLED: "1",
          DEV_AUTH_SECRET: "short",
          DEV_AUTH_SITE_URL: "http://127.0.0.1:3211",
        },
        "short",
      ),
    ).toBe(false);
  });

  it("rejects cloud dev deployments without an explicit localhost dev auth site", () => {
    expect(
      isLocalDevAuthEnabled(
        {
          CONVEX_SITE_URL: "http://127.0.0.1:3211",
          DEV_AUTH_ENABLED: "1",
          DEV_AUTH_SECRET: CLOUD_DEV_AUTH_SECRET,
          CONVEX_DEPLOYMENT: "dev:clever-rabbit-123",
        },
        CLOUD_DEV_AUTH_SECRET,
      ),
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
