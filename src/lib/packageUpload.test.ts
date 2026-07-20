/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import {
  buildPackageUploadEntries,
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

describe("buildPackageUploadEntries", () => {
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

  it("requests a fresh upload url for each file", async () => {
    const files = [
      {
        name: "package.json",
        size: 10,
        type: "application/json",
        webkitRelativePath: "demo-plugin/package.json",
      },
      {
        name: "dist/index.js",
        size: 20,
        type: "text/javascript",
        webkitRelativePath: "demo-plugin/dist/index.js",
      },
    ];
    const generateUploadUrl = vi
      .fn()
      .mockResolvedValueOnce("upload-1")
      .mockResolvedValueOnce("upload-2");
    const hashFile = vi.fn(async (file: (typeof files)[number]) => `sha:${file.name}`);
    const uploadFile = vi
      .fn()
      .mockResolvedValueOnce("storage:1")
      .mockResolvedValueOnce("storage:2");

    const uploaded = await buildPackageUploadEntries(files, {
      generateUploadUrl,
      hashFile,
      uploadFile,
    });

    expect(generateUploadUrl).toHaveBeenCalledTimes(2);
    expect(uploadFile).toHaveBeenNthCalledWith(1, "upload-1", files[0]);
    expect(uploadFile).toHaveBeenNthCalledWith(2, "upload-2", files[1]);
    expect(uploaded.map((entry) => entry.path)).toEqual(["package.json", "dist/index.js"]);
  });

  it("normalizes misleading text MIME types in upload entries", async () => {
    const uploaded = await buildPackageUploadEntries(
      [
        {
          name: "src/index.ts",
          size: 20,
          type: "video/mp2t",
        },
      ],
      {
        generateUploadUrl: async () => "upload-1",
        hashFile: async () => "sha:1",
        uploadFile: async () => "storage:1",
      },
    );

    expect(uploaded[0]?.contentType).toBe("application/typescript");
  });

  it("keeps nested archive paths when files do not have webkitRelativePath", async () => {
    const uploaded = await buildPackageUploadEntries(
      [
        {
          name: "dist/index.js",
          size: 20,
          type: "text/javascript",
        },
      ],
      {
        generateUploadUrl: async () => "upload-1",
        hashFile: async () => "sha:1",
        uploadFile: async () => "storage:1",
      },
    );

    expect(uploaded[0]?.path).toBe("dist/index.js");
  });

  it("strips the shared root for dropped folders without webkitRelativePath", async () => {
    const uploaded = await buildPackageUploadEntries(
      [
        {
          name: "demo-plugin/package.json",
          size: 10,
          type: "application/json",
        },
        {
          name: "demo-plugin/openclaw.plugin.json",
          size: 20,
          type: "application/json",
        },
        {
          name: "demo-plugin/dist/index.js",
          size: 30,
          type: "text/javascript",
        },
      ],
      {
        generateUploadUrl: async () => "upload-1",
        hashFile: async () => "sha:1",
        uploadFile: async () => "storage:1",
      },
    );

    expect(uploaded.map((entry) => entry.path)).toEqual([
      "package.json",
      "openclaw.plugin.json",
      "dist/index.js",
    ]);
  });
});
