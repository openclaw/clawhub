/* @vitest-environment node */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

function property(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, key);
}

describe("OpenAPI contract", () => {
  it("documents accepted skills sort aliases", async () => {
    const specPath = new URL("../../public/api/v1/openapi.json", import.meta.url);
    const spec: unknown = JSON.parse(await readFile(specPath, "utf8"));
    const paths = property(spec, "paths");
    const skillsPath = property(paths, "/api/v1/skills");
    const getOperation = property(skillsPath, "get");
    const parameters = property(getOperation, "parameters");
    const sortParameter = Array.isArray(parameters)
      ? parameters.find((parameter) => property(parameter, "name") === "sort")
      : undefined;
    const sortValues = property(property(sortParameter, "schema"), "enum");

    expect(sortValues).toEqual(expect.arrayContaining(["recommended", "default"]));
  });
});
