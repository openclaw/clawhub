import { describe, expect, it } from "vitest";
import { derivePluginPrefill } from "./pluginPublishPrefill";

function jsonFile(path: string, value: unknown) {
  return {
    path,
    file: new File([JSON.stringify(value)], path.split("/").at(-1) ?? path, {
      type: "application/json",
    }),
  };
}

describe("derivePluginPrefill", () => {
  it("prefers the OpenClaw plugin manifest name over package.json displayName", async () => {
    const prefill = await derivePluginPrefill([
      jsonFile("package.json", {
        name: "@scope/demo-plugin",
        displayName: "Package Display Name",
        version: "1.0.0",
      }),
      jsonFile("openclaw.plugin.json", {
        id: "demo.plugin",
        name: "Manifest Display Name",
      }),
    ]);

    expect(prefill.displayName).toBe("Manifest Display Name");
  });
});
