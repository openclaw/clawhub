import { describe, expect, it, vi } from "vitest";
import { pollForDeviceToken, requestDeviceCode } from "./deviceAuth.js";

describe("deviceAuth", () => {
  describe("requestDeviceCode", () => {
    it("should POST to /cli/device/code and return device code response", async () => {
      const mockResponse = {
        device_code: "abc123",
        user_code: "ABCD-1234",
        verification_uri: "https://clawhub.ai/device",
        expires_in: 900,
        interval: 5,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await requestDeviceCode({ siteUrl: "https://clawhub.ai" });

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://clawhub.ai/cli/device/code",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    it("should throw on non-ok response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve("endpoint not found"),
      });

      await expect(requestDeviceCode({ siteUrl: "https://clawhub.ai" })).rejects.toThrow(
        "Device code request failed (404)",
      );
    });

    it("should throw on invalid response (missing fields)", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ device_code: "abc" }),
      });

      await expect(requestDeviceCode({ siteUrl: "https://clawhub.ai" })).rejects.toThrow(
        "Invalid device code response",
      );
    });
  });

  describe("pollForDeviceToken", () => {
    it("should return token on successful authorization", async () => {
      const tokenResponse = {
        access_token: "token123",
        token_type: "bearer",
        scope: "read write",
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(tokenResponse),
      });

      const result = await pollForDeviceToken(
        { siteUrl: "https://clawhub.ai" },
        "device_code_123",
        { interval: 0.01, expiresIn: 10 },
      );

      expect(result.access_token).toBe("token123");
    });

    it("should keep polling on authorization_pending", async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: "authorization_pending" }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              access_token: "token_after_wait",
              token_type: "bearer",
              scope: "read write",
            }),
        });
      });

      const result = await pollForDeviceToken(
        { siteUrl: "https://clawhub.ai" },
        "device_code_123",
        { interval: 0.01, expiresIn: 10 },
      );

      expect(result.access_token).toBe("token_after_wait");
      expect(callCount).toBe(3);
    });

    it("should throw on access_denied", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "access_denied" }),
      });

      await expect(
        pollForDeviceToken({ siteUrl: "https://clawhub.ai" }, "device_code_123", {
          interval: 0.01,
          expiresIn: 10,
        }),
      ).rejects.toThrow("Authorization denied");
    });

    it("should throw on expired_token", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "expired_token" }),
      });

      await expect(
        pollForDeviceToken({ siteUrl: "https://clawhub.ai" }, "device_code_123", {
          interval: 0.01,
          expiresIn: 10,
        }),
      ).rejects.toThrow("expired");
    });
  });
});
