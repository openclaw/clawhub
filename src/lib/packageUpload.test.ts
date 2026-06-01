/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  appendPackageUploadFiles,
  filterIgnoredPackageFiles,
  normalizePackageUploadPath,
} from "./packageUpload";

describe("normalizePackageUploadPath", () => {
  it("strips the picked folder prefix", () => {
    expect(
      normalizePackageUploadPath("my-plugin/package.json", { stripTopLevelFolder: true }),
    ).toBe("package.json");
    expect(
      normalizePackageUploadPath("my-plugin/src/index.ts", { stripTopLevelFolder: true }),
    ).toBe("src/index.ts");
  });

  it("keeps flat files unchanged", () => {
    expect(normalizePackageUploadPath("package.json")).toBe("package.json");
  });

  it("preserves nested archive paths by default", () => {
    expect(normalizePackageUploadPath("dist/index.js")).toBe("dist/index.js");
  });
});

describe("package upload files", () => {
  it("filters builtin and package-ignore-file paths before upload", async () => {
    const filtered = await filterIgnoredPackageFiles([
      new File(["{}"], "demo-plugin/package.json", { type: "application/json" }),
      new File(["dist/\nsecret.txt\n"], "demo-plugin/.clawhubignore", { type: "text/plain" }),
      new File(["ignored"], "demo-plugin/node_modules/pkg/index.js", { type: "text/javascript" }),
      new File(["ignored"], "demo-plugin/.git/config", { type: "text/plain" }),
      new File(["ignored"], "demo-plugin/dist/index.js", { type: "text/javascript" }),
      new File(["kept"], "demo-plugin/src/index.js", { type: "text/javascript" }),
      new File(["ignored"], "demo-plugin/secret.txt", { type: "text/plain" }),
    ]);

    expect(filtered.files.map((file) => file.name)).toEqual([
      "demo-plugin/package.json",
      "demo-plugin/.clawhubignore",
      "demo-plugin/src/index.js",
    ]);
    expect(filtered.ignoredPaths).toEqual([
      "node_modules/pkg/index.js",
      ".git/config",
      "dist/index.js",
      "secret.txt",
    ]);
  });

  it("does not apply repo .gitignore rules to package uploads", async () => {
    const filtered = await filterIgnoredPackageFiles([
      new File(["{}"], "demo-plugin/package.json", { type: "application/json" }),
      new File(["dist/\nsecret.txt\n"], "demo-plugin/.gitignore", { type: "text/plain" }),
      new File(["kept"], "demo-plugin/dist/index.js", { type: "text/javascript" }),
      new File(["kept"], "demo-plugin/secret.txt", { type: "text/plain" }),
    ]);

    expect(filtered.files.map((file) => file.name)).toEqual([
      "demo-plugin/package.json",
      "demo-plugin/.gitignore",
      "demo-plugin/dist/index.js",
      "demo-plugin/secret.txt",
    ]);
    expect(filtered.ignoredPaths).toEqual([]);
  });

  it("appends package files with normalized paths", () => {
    const files = [
      withRelativePath(
        new File(["{}"], "package.json", { type: "application/json" }),
        "demo-plugin/package.json",
      ),
      withRelativePath(
        new File(["export {}"], "index.js", { type: "text/javascript" }),
        "demo-plugin/dist/index.js",
      ),
    ];
    const form = new FormData();

    appendPackageUploadFiles(form, files);

    expect(form.getAll("files").map((entry) => (entry as File).name)).toEqual([
      "package.json",
      "dist/index.js",
    ]);
  });

  it("normalizes misleading text MIME types in form data", () => {
    const form = new FormData();

    appendPackageUploadFiles(form, [
      new File(["export {}"], "src/index.ts", { type: "video/mp2t" }),
    ]);

    expect((form.get("files") as File).type).toBe("application/typescript");
  });

  it("keeps nested archive paths when files do not have webkitRelativePath", () => {
    const form = new FormData();

    appendPackageUploadFiles(form, [
      new File(["export {}"], "dist/index.js", { type: "text/javascript" }),
    ]);

    expect((form.get("files") as File).name).toBe("dist/index.js");
  });

  it("strips the shared root for dropped folders without webkitRelativePath", () => {
    const form = new FormData();

    appendPackageUploadFiles(form, [
      new File(["{}"], "demo-plugin/package.json", { type: "application/json" }),
      new File(["{}"], "demo-plugin/openclaw.plugin.json", { type: "application/json" }),
      new File(["export {}"], "demo-plugin/dist/index.js", { type: "text/javascript" }),
    ]);

    expect(form.getAll("files").map((entry) => (entry as File).name)).toEqual([
      "package.json",
      "openclaw.plugin.json",
      "dist/index.js",
    ]);
  });
});

function withRelativePath(file: File, path: string) {
  Object.defineProperty(file, "webkitRelativePath", {
    value: path,
    configurable: true,
  });
  return file;
}
