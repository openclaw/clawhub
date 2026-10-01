import { describe, expect, it } from "vitest";
import { formatOgStat, readOgDownloadsQuery, resolveOgDownloadsDisplay } from "./formatOgStats";

describe("formatOgStat", () => {
  it("formats large counts with compact k suffix", () => {
    expect(formatOgStat(43_456)).toBe("43.5k");
    expect(formatOgStat(282_345)).toBe("282k");
  });

  it("formats millions with compact M suffix", () => {
    expect(formatOgStat(2_360_000)).toBe("2.4M");
  });
});

describe("readOgDownloadsQuery", () => {
  it("prefers downloads over legacy installs", () => {
    expect(readOgDownloadsQuery({ downloads: "1200", installs: "9.9k" })).toBe("1200");
  });

  it("falls back to installs when downloads is missing", () => {
    expect(readOgDownloadsQuery({ installs: "9.9k" })).toBe("9.9k");
  });
});

describe("resolveOgDownloadsDisplay", () => {
  it("formats raw integer query params", () => {
    expect(resolveOgDownloadsDisplay({ downloads: "43456" })).toBe("43.5k");
    expect(resolveOgDownloadsDisplay({ downloads: "282345" })).toBe("282k");
  });

  it("formats metadata fallback values", () => {
    expect(resolveOgDownloadsDisplay({}, 1200)).toBe("1.2k");
  });

  it("passes through already-compact query values", () => {
    expect(resolveOgDownloadsDisplay({ downloads: "43.5k" })).toBe("43.5k");
  });
});
