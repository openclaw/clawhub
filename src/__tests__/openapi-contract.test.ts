/* @vitest-environment node */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

function property(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, key);
}

function sortValuesForPath(paths: unknown, path: string) {
  const routePath = property(paths, path);
  const getOperation = property(routePath, "get");
  const parameters = property(getOperation, "parameters");
  const sortParameter = Array.isArray(parameters)
    ? parameters.find((parameter) => property(parameter, "name") === "sort")
    : undefined;
  return property(property(sortParameter, "schema"), "enum");
}

function responseContentForPath(paths: unknown, path: string, status: string) {
  const routePath = property(paths, path);
  const getOperation = property(routePath, "get");
  const responses = property(getOperation, "responses");
  return property(property(responses, status), "content");
}

describe("OpenAPI contract", () => {
  it("documents accepted skills sort aliases", async () => {
    const specPath = new URL("../../public/api/v1/openapi.json", import.meta.url);
    const spec: unknown = JSON.parse(await readFile(specPath, "utf8"));
    const paths = property(spec, "paths");

    expect(sortValuesForPath(paths, "/api/v1/skills")).toEqual([
      "recommended",
      "default",
      "updated",
      "createdAt",
      "newest",
      "downloads",
      "stars",
      "rating",
      "installsCurrent",
      "installs",
      "installsAllTime",
      "trending",
    ]);
  });

  it("documents package and plugin downloads sort aliases", async () => {
    const specPath = new URL("../../public/api/v1/openapi.json", import.meta.url);
    const spec: unknown = JSON.parse(await readFile(specPath, "utf8"));
    const paths = property(spec, "paths");
    const sortValues = ["updated", "recommended", "downloads", "installs"];

    expect(sortValuesForPath(paths, "/api/v1/packages")).toEqual(sortValues);
    expect(sortValuesForPath(paths, "/api/v1/plugins")).toEqual(sortValues);
    expect(sortValuesForPath(paths, "/api/v1/code-plugins")).toEqual(sortValues);
    expect(sortValuesForPath(paths, "/api/v1/bundle-plugins")).toEqual(sortValues);
  });

  it("documents skill downloads as either hosted ZIP bytes or GitHub handoff JSON", async () => {
    const specPath = new URL("../../public/api/v1/openapi.json", import.meta.url);
    const spec: unknown = JSON.parse(await readFile(specPath, "utf8"));
    const paths = property(spec, "paths");
    const schemas = property(property(spec, "components"), "schemas");

    const responseContent = responseContentForPath(paths, "/api/v1/download", "200");
    expect(property(responseContent, "application/zip")).toBeTruthy();
    expect(property(property(responseContent, "application/json"), "schema")).toEqual({
      $ref: "#/components/schemas/GitHubSkillDownloadHandoff",
    });

    const handoffSchema = property(schemas, "GitHubSkillDownloadHandoff");
    expect(property(handoffSchema, "required")).toEqual([
      "sourceRef",
      "repo",
      "commit",
      "path",
      "contentHash",
      "archiveUrl",
    ]);
    expect(property(property(handoffSchema, "properties"), "scan")).toBeUndefined();
    expect(property(property(handoffSchema, "properties"), "scanStatus")).toBeUndefined();
  });
});
