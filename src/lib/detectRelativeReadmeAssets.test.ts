/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { detectRelativeReadmeAssets } from "./detectRelativeReadmeAssets";

describe("detectRelativeReadmeAssets", () => {
  it("returns nothing for empty input", () => {
    expect(detectRelativeReadmeAssets("")).toEqual({
      samples: [],
      total: 0,
      unresolvableSamples: [],
      unresolvableTotal: 0,
    });
  });

  it("flags a relative markdown image reference", () => {
    const report = detectRelativeReadmeAssets("![diagram](./images/foo.png)");
    expect(report.samples).toEqual(["./images/foo.png"]);
    expect(report.total).toBe(1);
    expect(report.unresolvableSamples).toEqual([]);
    expect(report.unresolvableTotal).toBe(0);
  });

  it("flags relative <img src> references in raw HTML", () => {
    const report = detectRelativeReadmeAssets(
      `<img src="images/foo.png" alt="x"/><img src='./bar.svg'/>`,
    );
    expect(report.samples).toEqual(["images/foo.png", "./bar.svg"]);
    expect(report.total).toBe(2);
    expect(report.unresolvableSamples).toEqual([]);
  });

  it("flags root-absolute paths separately as unresolvable", () => {
    const report = detectRelativeReadmeAssets("![logo](/static/logo.png)");
    expect(report.samples).toEqual(["/static/logo.png"]);
    expect(report.total).toBe(1);
    expect(report.unresolvableSamples).toEqual(["/static/logo.png"]);
    expect(report.unresolvableTotal).toBe(1);
  });

  it("ignores absolute http(s) URLs", () => {
    const report = detectRelativeReadmeAssets(
      '![ok](https://example.com/foo.png)\n<img src="http://example.com/x.png"/>',
    );
    expect(report).toEqual({
      samples: [],
      total: 0,
      unresolvableSamples: [],
      unresolvableTotal: 0,
    });
  });

  it("ignores protocol-relative URLs, data:, mailto:, tel:, and fragment hrefs", () => {
    const report = detectRelativeReadmeAssets(
      [
        "![a](//cdn.example.com/x.png)",
        "![b](data:image/png;base64,abc)",
        "![c](#anchor)",
        '<img src="mailto:x@y"/>',
      ].join("\n"),
    );
    expect(report).toEqual({
      samples: [],
      total: 0,
      unresolvableSamples: [],
      unresolvableTotal: 0,
    });
  });

  it("deduplicates samples but counts each occurrence in total", () => {
    const report = detectRelativeReadmeAssets(
      '![a](./x.png)\n![a](./x.png)\n<img src="./x.png"/>\n![b](./y.png)',
    );
    expect(report.samples).toEqual(["./x.png", "./y.png"]);
    expect(report.total).toBe(4);
  });

  it("counts unresolvable references in total but separates them in unresolvableSamples", () => {
    const report = detectRelativeReadmeAssets(
      '![rel](./images/foo.png)\n![bad](/static/logo.png)\n![bad](/static/logo.png)\n<img src="/icons/x.svg"/>',
    );
    expect(report.samples).toEqual(["./images/foo.png", "/static/logo.png", "/icons/x.svg"]);
    expect(report.total).toBe(4);
    expect(report.unresolvableSamples).toEqual(["/static/logo.png", "/icons/x.svg"]);
    expect(report.unresolvableTotal).toBe(3);
  });

  it("caps samples at 5 distinct paths but keeps counting in total", () => {
    const lines = Array.from({ length: 10 }, (_, idx) => `![n](./img-${idx}.png)`);
    const report = detectRelativeReadmeAssets(lines.join("\n"));
    expect(report.samples.length).toBe(5);
    expect(report.samples).toEqual([
      "./img-0.png",
      "./img-1.png",
      "./img-2.png",
      "./img-3.png",
      "./img-4.png",
    ]);
    expect(report.total).toBe(10);
  });

  it("handles markdown image references with a title segment", () => {
    const report = detectRelativeReadmeAssets(`![alt](./images/foo.png "title text")`);
    expect(report.samples).toEqual(["./images/foo.png"]);
  });
});
