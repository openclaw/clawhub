import { describe, expect, test } from "vitest";
import { buildRemoteReferenceFindings, extractExternalReferences } from "./remoteAssetPolicy";

describe("remote asset policy", () => {
  test("extracts external URLs from submitted files", () => {
    const refs = extractExternalReferences({
      files: [
        {
          path: "SKILL.md",
          content: "Install from https://raw.githubusercontent.com/acme/tool/main/install.sh",
        },
      ],
    });

    expect(refs).toMatchObject([
      {
        url: "https://raw.githubusercontent.com/acme/tool/main/install.sh",
        file: "SKILL.md",
        line: 1,
      },
    ]);
  });

  test("blocks raw.githubusercontent.com main branch references", () => {
    const findings = buildRemoteReferenceFindings({
      files: [
        {
          path: "SKILL.md",
          content: "Run https://raw.githubusercontent.com/acme/tool/main/install.sh",
        },
      ],
    });

    expect(findings.some((finding) => finding.code === "REMOTE_REFERENCE_UNPINNED_GITHUB")).toBe(
      true,
    );
    expect(findings.some((finding) => finding.code === "REMOTE_REFERENCE_HASH_MISSING")).toBe(true);
  });

  test("blocks github.com blob main references", () => {
    const findings = buildRemoteReferenceFindings({
      files: [
        {
          path: "README.md",
          content: "See https://github.com/acme/tool/blob/main/plugin.js",
        },
      ],
    });

    expect(findings.some((finding) => finding.code === "REMOTE_REFERENCE_UNPINNED_GITHUB")).toBe(
      true,
    );
  });

  test("accepts full commit pinned raw GitHub reference with nearby SHA-256", () => {
    const findings = buildRemoteReferenceFindings({
      files: [
        {
          path: "SKILL.md",
          content:
            "url: https://raw.githubusercontent.com/acme/tool/0123456789abcdef0123456789abcdef01234567/install.sh\nsha256: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      ],
    });

    expect(findings).toEqual([]);
  });

  test("blocks plaintext HTTP remote references", () => {
    const findings = buildRemoteReferenceFindings({
      files: [
        {
          path: "SKILL.md",
          content: "Download http://bad.example.invalid/tool.sh",
        },
      ],
    });

    expect(findings.some((finding) => finding.code === "REMOTE_REFERENCE_INSECURE_HTTP")).toBe(
      true,
    );
  });

  test("ignores example and localhost references", () => {
    const findings = buildRemoteReferenceFindings({
      files: [
        {
          path: "SKILL.md",
          content: "Docs: https://example.com/tool and http://localhost:3000/test",
        },
      ],
    });

    expect(findings).toEqual([]);
  });
});
