import { describe, expect, it } from "vitest";
import {
  isReservedOpenClawExtensionHandle,
  isReservedPublicOwnerHandle,
} from "./publicRouteReservations";

describe("public route reservations", () => {
  it.each(["admin", "clawhub", "creators", "docs", "plugins", "publishers", "skills"])(
    "reserves @%s as a public owner handle",
    (handle) => {
      expect(isReservedPublicOwnerHandle(handle)).toBe(true);
    },
  );

  it.each(["codex", "tencent"])("reserves @%s as an OpenClaw alias", (handle) => {
    expect(isReservedOpenClawExtensionHandle(handle)).toBe(true);
    expect(isReservedPublicOwnerHandle(handle)).toBe(false);
  });

  it("does not normalize at-sign prefixes", () => {
    expect(isReservedPublicOwnerHandle("@clawhub")).toBe(false);
  });
});
