import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { validateTemplatePackageContents as validateCliTemplatePackageContents } from "../../clawhub/src/schema/templatePackage.js";
import { OPENCLAW_TEMPLATE_AGENT_POLICY_V1 } from "./templateAgent.js";
import {
  validateTemplatePackageContents,
  type TemplatePackageTextFile,
} from "./templatePackage.js";

type ProfileCase = {
  name: string;
  consumerAccepted: boolean;
  registryAccepted: boolean;
  yaml: string;
};
type MetadataCase = {
  name: string;
  consumerAccepted: boolean;
  registryAccepted: boolean;
  metadata: Record<string, string>;
};
type ConformanceCases = {
  consumer: { repository: string; commit: string };
  agentCases: ProfileCase[];
  heartbeatCases: ProfileCase[];
  pluginCases: ProfileCase[];
  metadataCases: MetadataCase[];
  projectArtifact: { path: string; consumerAccepted: boolean; registryAccepted: boolean };
};

const repositoryRoot = process.cwd();
const cases = JSON.parse(
  readFileSync(resolve(repositoryRoot, "fixtures/templates/conformance-v1/cases.json"), "utf8"),
) as ConformanceCases;

const baseManifest = {
  schemaVersion: 1,
  agent: { id: "conformance-claw" },
};
const packageJson = {
  name: "@openclaw/conformance-claw",
  version: "1.0.0",
  openclaw: { template: "CLAW.md" },
};

function validateProfile(
  validate: typeof validateTemplatePackageContents,
  yaml: string,
  metadata: Record<string, string> = {},
) {
  return validate({
    packageName: packageJson.name,
    version: packageJson.version,
    packageJson,
    files: [
      { path: "package.json", text: JSON.stringify(packageJson) },
      {
        path: "CLAW.md",
        text: `---\n${JSON.stringify({ ...baseManifest, ...parse(yaml || "{}"), agent: { ...baseManifest.agent, ...parse(yaml || "{}").agent }, metadata })}\n---\n`,
      },
    ],
  });
}

function readProjectFiles(root: string): TemplatePackageTextFile[] {
  const files: TemplatePackageTextFile[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else {
        files.push({
          path: relative(root, path).replaceAll("\\", "/"),
          text: readFileSync(path, "utf8"),
        });
      }
    }
  };
  visit(root);
  return files;
}

describe(`ClawHub parity with ${cases.consumer.repository}@${cases.consumer.commit}`, () => {
  it("pins the same shipped consumer as the profile policy artifact", () => {
    expect(cases.consumer).toEqual({
      repository: OPENCLAW_TEMPLATE_AGENT_POLICY_V1.source.repository,
      commit: OPENCLAW_TEMPLATE_AGENT_POLICY_V1.source.commit,
    });
  });

  it("never marks a registry-accepted vector as consumer-rejected", () => {
    const vectors = [
      ...cases.agentCases,
      ...cases.heartbeatCases,
      ...cases.pluginCases,
      ...cases.metadataCases,
      cases.projectArtifact,
    ];
    expect(vectors.filter((entry) => entry.registryAccepted && !entry.consumerAccepted)).toEqual(
      [],
    );
  });

  describe.each([
    { name: "registry", validate: validateTemplatePackageContents },
    { name: "CLI", validate: validateCliTemplatePackageContents },
  ])("$name", ({ validate }) => {
    it.each([...cases.agentCases, ...cases.heartbeatCases, ...cases.pluginCases])(
      "$name",
      ({ registryAccepted, yaml }) => {
        expect(validateProfile(validate, yaml).ok).toBe(registryAccepted);
      },
    );

    it.each(cases.metadataCases)("$name", ({ registryAccepted, metadata }) => {
      expect(validateProfile(validate, "", metadata).ok).toBe(registryAccepted);
    });

    it("accepts the shared hosted project artifact", () => {
      const root = resolve(repositoryRoot, cases.projectArtifact.path);
      const files = readProjectFiles(root);
      const parsedPackageJson = JSON.parse(
        files.find((file) => file.path === "package.json")?.text ?? "null",
      ) as { name: string; version: string };
      const result = validate({
        packageName: parsedPackageJson.name,
        version: parsedPackageJson.version,
        packageJson: parsedPackageJson,
        files,
      });

      expect(result.ok).toBe(cases.projectArtifact.registryAccepted);
      if (result.ok) {
        expect(result.value.summary).toMatchObject({
          packages: { skillCount: 1, pluginCount: 1 },
        });
      }
    });
  });
});
