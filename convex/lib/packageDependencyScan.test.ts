import { describe, expect, it } from "vitest";
import {
  buildOsvQueryBatchRequest,
  cleanDependencyScanResult,
  extractNpmDependencies,
  mergeOsvQueryBatchResponses,
  normalizeOsvQueryBatchResponse,
  splitOsvQueryBatchRequest,
} from "./packageDependencyScan";

describe("packageDependencyScan", () => {
  it("extracts exact npm dependency versions from package-lock files", () => {
    const dependencies = extractNpmDependencies([
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            lodash: "^4.17.0",
          },
          devDependencies: {
            vitest: "4.1.9",
          },
        }),
      },
      {
        path: "package-lock.json",
        content: JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": {
              dependencies: {
                lodash: "^4.17.0",
              },
              devDependencies: {
                vitest: "4.1.9",
              },
            },
            "node_modules/lodash": {
              version: "4.17.21",
            },
            "node_modules/vitest": {
              version: "4.1.9",
              dev: true,
            },
          },
        }),
      },
    ]);

    expect(dependencies).toEqual([
      expect.objectContaining({
        name: "lodash",
        dependencyKind: "dependencies",
        requestedRange: "^4.17.0",
        resolvedVersion: "4.17.21",
      }),
    ]);
    expect(buildOsvQueryBatchRequest(dependencies)).toEqual({
      queries: [
        {
          package: { name: "lodash", ecosystem: "npm" },
          version: "4.17.21",
        },
      ],
    });
  });

  it("extracts non-dev transitive npm packages from lockfiles", () => {
    const dependencies = extractNpmDependencies([
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            wrapper: "^1.0.0",
          },
        }),
      },
      {
        path: "package-lock.json",
        content: JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": {
              dependencies: {
                wrapper: "^1.0.0",
              },
            },
            "node_modules/wrapper": {
              version: "1.0.0",
            },
            "node_modules/wrapper/node_modules/plain-crypto-js": {
              version: "0.1.0",
            },
            "node_modules/wrapper/node_modules/dev-optional-malware": {
              version: "2.0.0",
              devOptional: true,
            },
            "node_modules/vitest": {
              version: "4.1.9",
              dev: true,
            },
          },
        }),
      },
    ]);

    expect(dependencies).toEqual([
      expect.objectContaining({
        name: "wrapper",
        manifestPath: "package.json",
        dependencyKind: "dependencies",
        resolvedVersion: "1.0.0",
      }),
      expect.objectContaining({
        name: "plain-crypto-js",
        manifestPath: "package-lock.json",
        resolvedVersion: "0.1.0",
      }),
      expect.objectContaining({
        name: "dev-optional-malware",
        manifestPath: "package-lock.json",
        resolvedVersion: "2.0.0",
      }),
    ]);
    expect(dependencies[1]).not.toHaveProperty("dependencyKind");
    expect(dependencies[2]).not.toHaveProperty("dependencyKind");
    expect(buildOsvQueryBatchRequest(dependencies)).toEqual({
      queries: [
        {
          package: { name: "wrapper", ecosystem: "npm" },
          version: "1.0.0",
        },
        {
          package: { name: "plain-crypto-js", ecosystem: "npm" },
          version: "0.1.0",
        },
        {
          package: { name: "dev-optional-malware", ecosystem: "npm" },
          version: "2.0.0",
        },
      ],
    });
  });

  it("extracts exact bundled package versions from node_modules package manifests", () => {
    const dependencies = extractNpmDependencies([
      {
        path: "package.json",
        content: JSON.stringify({
          bundledDependencies: ["plain-crypto-js"],
        }),
      },
      {
        path: "node_modules/plain-crypto-js/package.json",
        content: JSON.stringify({
          name: "plain-crypto-js",
          version: "0.1.0",
        }),
      },
    ]);

    expect(dependencies).toEqual([
      expect.objectContaining({
        name: "plain-crypto-js",
        manifestPath: "package.json",
        dependencyKind: "bundledDependencies",
      }),
      expect.objectContaining({
        name: "plain-crypto-js",
        resolvedPackageName: "plain-crypto-js",
        manifestPath: "node_modules/plain-crypto-js/package.json",
        resolvedVersion: "0.1.0",
      }),
    ]);
    expect(buildOsvQueryBatchRequest(dependencies)).toEqual({
      queries: [
        {
          package: { name: "plain-crypto-js", ecosystem: "npm" },
          version: "0.1.0",
        },
      ],
    });
  });

  it("uses real package names from lockfiles for npm aliases", () => {
    const dependencies = extractNpmDependencies([
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            "safe-name": "npm:demo-malware@1.0.0",
          },
        }),
      },
      {
        path: "package-lock.json",
        content: JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "node_modules/safe-name": {
              name: "demo-malware",
              version: "1.0.0",
            },
          },
        }),
      },
    ]);

    expect(dependencies).toEqual([
      expect.objectContaining({
        name: "safe-name",
        resolvedPackageName: "demo-malware",
        resolvedVersion: "1.0.0",
      }),
    ]);
    expect(buildOsvQueryBatchRequest(dependencies)).toEqual({
      queries: [
        {
          package: { name: "demo-malware", ecosystem: "npm" },
          version: "1.0.0",
        },
      ],
    });
  });

  it("uses real package names from package-lock v1 npm alias entries", () => {
    const dependencies = extractNpmDependencies([
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            "safe-name": "npm:demo-malware@1.0.0",
          },
        }),
      },
      {
        path: "package-lock.json",
        content: JSON.stringify({
          lockfileVersion: 1,
          dependencies: {
            "safe-name": {
              version: "npm:demo-malware@1.0.0",
            },
          },
        }),
      },
    ]);

    expect(dependencies).toEqual([
      expect.objectContaining({
        name: "safe-name",
        resolvedPackageName: "demo-malware",
        resolvedVersion: "1.0.0",
      }),
    ]);
    expect(buildOsvQueryBatchRequest(dependencies)).toEqual({
      queries: [
        {
          package: { name: "demo-malware", ecosystem: "npm" },
          version: "1.0.0",
        },
      ],
    });
  });

  it("extracts transitive packages from package-lock v1 dependencies", () => {
    const dependencies = extractNpmDependencies([
      {
        path: "package-lock.json",
        content: JSON.stringify({
          lockfileVersion: 1,
          dependencies: {
            wrapper: {
              version: "1.0.0",
              dependencies: {
                "plain-crypto-js": {
                  version: "0.1.0",
                },
                "dev-helper": {
                  version: "2.0.0",
                  dev: true,
                },
                "dev-optional-malware": {
                  version: "3.0.0",
                  devOptional: true,
                },
              },
            },
          },
        }),
      },
    ]);

    expect(buildOsvQueryBatchRequest(dependencies)).toEqual({
      queries: [
        {
          package: { name: "wrapper", ecosystem: "npm" },
          version: "1.0.0",
        },
        {
          package: { name: "plain-crypto-js", ecosystem: "npm" },
          version: "0.1.0",
        },
        {
          package: { name: "dev-optional-malware", ecosystem: "npm" },
          version: "3.0.0",
        },
      ],
    });
  });

  it("splits and merges OSV querybatch payloads without reordering results", () => {
    const request = {
      queries: [
        { package: { name: "one", ecosystem: "npm" as const }, version: "1.0.0" },
        { package: { name: "two", ecosystem: "npm" as const }, version: "2.0.0" },
        { package: { name: "three", ecosystem: "npm" as const }, version: "3.0.0" },
      ],
    };

    expect(splitOsvQueryBatchRequest(request, 2)).toEqual([
      { queries: request.queries.slice(0, 2) },
      { queries: request.queries.slice(2) },
    ]);
    expect(
      mergeOsvQueryBatchResponses([
        { results: [{ vulns: [{ id: "GHSA-1", aliases: [] }] }, {}] },
        { results: [{ vulns: [{ id: "MAL-2026-1", aliases: [] }] }] },
      ]),
    ).toEqual({
      results: [
        { vulns: [{ id: "GHSA-1", aliases: [] }] },
        {},
        { vulns: [{ id: "MAL-2026-1", aliases: [] }] },
      ],
    });
  });

  it("normalizes exact manifest versions before querying OSV", () => {
    const dependencies = extractNpmDependencies([
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            "equals-version": "=1.2.3",
            "tagged-version": "v2.3.4",
            "alias-version": "npm:real-package@3.4.5",
          },
        }),
      },
    ]);

    expect(buildOsvQueryBatchRequest(dependencies)).toEqual({
      queries: [
        {
          package: { name: "equals-version", ecosystem: "npm" },
          version: "1.2.3",
        },
        {
          package: { name: "tagged-version", ecosystem: "npm" },
          version: "2.3.4",
        },
        {
          package: { name: "real-package", ecosystem: "npm" },
          version: "3.4.5",
        },
      ],
    });
  });

  it("normalizes OSV malicious advisories as install-blocking malicious results", () => {
    const dependencies = extractNpmDependencies([
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            "demo-malware": "1.0.0",
          },
        }),
      },
    ]);

    const result = normalizeOsvQueryBatchResponse({
      dependencies,
      checkedAt: 123,
      response: {
        results: [
          {
            vulns: [
              {
                id: "MAL-2026-1234",
                summary: "Malicious package",
                aliases: [],
              },
            ],
          },
        ],
      },
    });

    expect(result).toMatchObject({
      status: "malicious",
      findings: [
        {
          advisoryId: "MAL-2026-1234",
          classification: "malware",
          confidence: "high",
          packageName: "demo-malware",
          version: "1.0.0",
        },
      ],
    });
    expect(result.findings[0]).not.toHaveProperty("severity");
    expect(result.findings[0]).not.toHaveProperty("url");
  });

  it("preserves manifest aliases on normalized OSV findings", () => {
    const dependencies = extractNpmDependencies([
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            "safe-name": "npm:demo-malware@1.0.0",
          },
        }),
      },
      {
        path: "package-lock.json",
        content: JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "node_modules/safe-name": {
              name: "demo-malware",
              version: "1.0.0",
            },
          },
        }),
      },
    ]);

    const result = normalizeOsvQueryBatchResponse({
      dependencies,
      checkedAt: 123,
      response: {
        results: [
          {
            vulns: [
              {
                id: "MAL-2026-1234",
                summary: "Malicious package",
                aliases: [],
              },
            ],
          },
        ],
      },
    });

    expect(result.findings).toEqual([
      expect.objectContaining({
        packageName: "demo-malware",
        manifestName: "safe-name",
      }),
    ]);
  });

  it("normalizes malicious transitive lockfile advisories as blocking malware", () => {
    const dependencies = extractNpmDependencies([
      {
        path: "package-lock.json",
        content: JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "node_modules/wrapper": {
              version: "1.0.0",
            },
            "node_modules/wrapper/node_modules/plain-crypto-js": {
              version: "0.1.0",
            },
          },
        }),
      },
    ]);

    const result = normalizeOsvQueryBatchResponse({
      dependencies,
      checkedAt: 123,
      response: {
        results: [
          {},
          {
            vulns: [
              {
                id: "MAL-2026-4321",
                summary: "Malicious transitive package",
                aliases: [],
              },
            ],
          },
        ],
      },
    });

    expect(result).toMatchObject({
      status: "malicious",
      findings: [
        {
          advisoryId: "MAL-2026-4321",
          classification: "malware",
          confidence: "high",
          packageName: "plain-crypto-js",
          version: "0.1.0",
          manifestPath: "package-lock.json",
        },
      ],
    });
    expect(result.findings[0]).not.toHaveProperty("dependencyKind");
  });

  it("normalizes ordinary OSV vulnerabilities as suspicious advisory results", () => {
    const dependencies = extractNpmDependencies([
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            lodash: "4.17.20",
          },
        }),
      },
    ]);

    const result = normalizeOsvQueryBatchResponse({
      dependencies,
      checkedAt: 123,
      response: {
        results: [
          {
            vulns: [
              {
                id: "GHSA-1234-5678-9012",
                summary: "Prototype pollution",
                aliases: ["CVE-2026-1234"],
              },
            ],
          },
        ],
      },
    });

    expect(result).toMatchObject({
      status: "suspicious",
      findings: [
        {
          advisoryId: "GHSA-1234-5678-9012",
          classification: "vulnerability",
          confidence: "medium",
          packageName: "lodash",
          version: "4.17.20",
        },
      ],
    });
  });

  it("does not mark range-only dependencies as clean", () => {
    const dependencies = extractNpmDependencies([
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            lodash: "^4.17.0",
          },
        }),
      },
    ]);

    expect(cleanDependencyScanResult({ dependencies, checkedAt: 123 })).toMatchObject({
      status: "skipped",
      dependencyCount: 1,
      scannedDependencyCount: 0,
      skippedDependencyCount: 1,
    });
  });

  it("does not mark partially scanned dependency sets as clean", () => {
    const dependencies = extractNpmDependencies([
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            exact: "1.0.0",
            ranged: "^2.0.0",
          },
        }),
      },
    ]);

    const result = normalizeOsvQueryBatchResponse({
      dependencies,
      checkedAt: 123,
      response: {
        results: [{}],
      },
    });

    expect(result).toMatchObject({
      status: "skipped",
      dependencyCount: 2,
      scannedDependencyCount: 1,
      skippedDependencyCount: 1,
      findings: [],
    });
  });

  it("rejects malformed OSV querybatch responses", () => {
    const dependencies = extractNpmDependencies([
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            lodash: "4.17.20",
          },
        }),
      },
    ]);

    expect(() =>
      normalizeOsvQueryBatchResponse({
        dependencies,
        checkedAt: 123,
        response: {},
      }),
    ).toThrow(/results array/);

    expect(() =>
      normalizeOsvQueryBatchResponse({
        dependencies,
        checkedAt: 123,
        response: { results: [] },
      }),
    ).toThrow(/result count/);
  });
});
