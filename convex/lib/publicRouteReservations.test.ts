import { describe, expect, it } from "vitest";
import { isReservedPublicOwnerHandle } from "./publicRouteReservations";

describe("public route reservations", () => {
  it.each(["admin", "plugins", "skills"])("reserves @%s as a public owner handle", (handle) => {
    expect(isReservedPublicOwnerHandle(handle)).toBe(true);
  });
});
