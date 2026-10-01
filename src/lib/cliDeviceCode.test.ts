import { describe, expect, it } from "vitest";
import { isCliDeviceUserCode } from "./cliDeviceCode";

describe("isCliDeviceUserCode", () => {
  it.each(["ABCD-2345", "abcd-2345", "  ABCD-2345  "])("accepts %j", (value) => {
    expect(isCliDeviceUserCode(value)).toBe(true);
  });

  it.each([
    "",
    "ABCD2345",
    "ABCD-234",
    "ABCDE-2345",
    "ABCI-2345",
    "ABCO-2345",
    "ABCD-0345",
    "ABCD-1345",
    "long-random-oauth-completion-code",
  ])("rejects %j", (value) => {
    expect(isCliDeviceUserCode(value)).toBe(false);
  });
});
