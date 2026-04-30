/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import * as schema from ".";
import {
  guessTextContentType,
  isTextContentType,
  normalizeTextContentType,
  TEXT_FILE_EXTENSION_SET,
} from "./textFiles";

describe("clawhub-schema textFiles", () => {
  it("exports text-file extension set", () => {
    expect(TEXT_FILE_EXTENSION_SET.has("md")).toBe(true);
    expect(TEXT_FILE_EXTENSION_SET.has("r")).toBe(true);
    expect(TEXT_FILE_EXTENSION_SET.has("exe")).toBe(false);
  });

  it("detects text content types with parameters", () => {
    expect(isTextContentType("text/plain; charset=utf-8")).toBe(true);
    expect(isTextContentType("application/json; charset=utf-8")).toBe(true);
    expect(isTextContentType("application/octet-stream")).toBe(false);
  });

  it("guesses canonical content types for text files", () => {
    expect(guessTextContentType("src/index.ts")).toBe("application/typescript");
    expect(guessTextContentType("README.md")).toBe("text/markdown");
    expect(guessTextContentType("analysis/model.R")).toBe("text/plain");
    expect(guessTextContentType("image.png")).toBeUndefined();
  });

  it("normalizes misleading MIME types for text files", () => {
    expect(normalizeTextContentType("src/index.ts", "video/mp2t")).toBe("application/typescript");
    expect(normalizeTextContentType("README.md", "text/markdown; charset=utf-8")).toBe(
      "text/markdown",
    );
    expect(normalizeTextContentType("image.png", "image/png")).toBe("image/png");
  });

  it("re-exports helpers from index", () => {
    expect(typeof schema.isTextContentType).toBe("function");
    expect(schema.isTextContentType("application/markdown")).toBe(true);
    expect(schema.normalizeTextContentType("src/index.ts", "video/mp2t")).toBe(
      "application/typescript",
    );
  });
});
