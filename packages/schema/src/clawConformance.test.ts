import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OPENCLAW_CLAW_PROFILE_POLICY_V1,
  validateClawPackageContents,
  type ClawPackageTextFile,
} from "./clawPackage.js";

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
  profileCases: ProfileCase[];
  heartbeatCases: ProfileCase[];
  extensionCases: ProfileCase[];
  metadataCases: MetadataCase[];
  projectArtifact: { path: string; consumerAccepted: boolean; registryAccepted: boolean };
};

const repositoryRoot = process.cwd();
const cases = JSON.parse(
  readFileSync(resolve(repositoryRoot, "fixtures/claws/conformance-v1/cases.json"), "utf8"),
) as ConformanceCases;

const baseManifest = {
  schemaVersion: 1,
  agent: { id: "conformance-claw" },
};
const packageJson = {
  name: "@openclaw/conformance-claw",
  version: "1.0.0",
  openclaw: { claw: "CLAW.md" },
};

function validateProfile(yaml: string, metadata: Record<string, string> = {}) {
  return validateClawPackageContents({
    packageName: packageJson.name,
    version: packageJson.version,
    packageJson,
    files: [
      { path: "package.json", text: JSON.stringify(packageJson) },
      {
        path: "CLAW.md",
        text: `---\n${JSON.stringify({ ...baseManifest, metadata })}\n---\n`,
      },
      ...(yaml ? [{ path: "profiles/openclaw.yml", text: yaml }] : []),
    ],
  });
}

function readProjectFiles(root: string): ClawPackageTextFile[] {
  const files: ClawPackageTextFile[] = [];
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
      repository: OPENCLAW_CLAW_PROFILE_POLICY_V1.source.repository,
      commit: OPENCLAW_CLAW_PROFILE_POLICY_V1.source.commit,
    });
  });

  it("never marks a registry-accepted vector as consumer-rejected", () => {
    const vectors = [
      ...cases.profileCases,
      ...cases.heartbeatCases,
      ...cases.extensionCases,
      ...cases.metadataCases,
      cases.projectArtifact,
    ];
    expect(vectors.filter((entry) => entry.registryAccepted && !entry.consumerAccepted)).toEqual(
      [],
    );
  });

  it.each(["claws.ts", "clawPackage.ts"])(
    "keeps the standalone CLI %s validator identical",
    (filename) => {
      expect(readFileSync(resolve(repositoryRoot, "packages/schema/src", filename), "utf8")).toBe(
        readFileSync(resolve(repositoryRoot, "packages/clawhub/src/schema", filename), "utf8"),
      );
    },
  );

  it.each([...cases.profileCases, ...cases.heartbeatCases, ...cases.extensionCases])(
    "$name",
    ({ registryAccepted, yaml }) => {
      expect(validateProfile(yaml).ok).toBe(registryAccepted);
    },
  );

  it.each(cases.metadataCases)("$name", ({ registryAccepted, metadata }) => {
    expect(validateProfile("", metadata).ok).toBe(registryAccepted);
  });

  it("accepts the shared hosted project artifact", () => {
    const root = resolve(repositoryRoot, cases.projectArtifact.path);
    const files = readProjectFiles(root);
    const parsedPackageJson = JSON.parse(
      files.find((file) => file.path === "package.json")?.text ?? "null",
    ) as { name: string; version: string };
    const result = validateClawPackageContents({
      packageName: parsedPackageJson.name,
      version: parsedPackageJson.version,
      packageJson: parsedPackageJson,
      files,
    });

    expect(result.ok).toBe(cases.projectArtifact.registryAccepted);
    if (result.ok) {
      expect(result.value.summary).toMatchObject({
        profiles: { count: 1, hasOpenClaw: true },
        extensions: { count: 0 },
      });
    }
  });
});
