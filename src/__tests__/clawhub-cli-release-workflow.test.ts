import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ClawHub CLI release workflows", () => {
  it("requires publish-specific proof before adding npm publish release proof", () => {
    const npmRelease = readFileSync(
      resolve(".github/workflows/clawhub-cli-npm-release.yml"),
      "utf8",
    );
    const githubRelease = readFileSync(
      resolve(".github/workflows/clawhub-cli-github-release.yml"),
      "utf8",
    );

    expect(npmRelease).toContain("Write npm publish proof artifact");
    expect(npmRelease).toContain("Upload npm publish proof artifact");
    expect(npmRelease).toContain("clawhub-cli-npm-publish-${{ inputs.tag }}");
    expect(npmRelease).toContain(
      'printf \'%s\\n\' "false" > "$PUBLISH_PROOF_DIR/preflight-only.txt"',
    );

    expect(githubRelease).toContain("Verify publish proof artifact");
    expect(githubRelease).toContain("clawhub-cli-npm-publish-${RELEASE_TAG}");
    expect(githubRelease).toContain("Publish artifact must come from a real publish run.");
    expect(githubRelease).toContain("Publish artifact tarball URL does not match npm metadata.");
    expect(githubRelease).toContain("Publish artifact integrity does not match npm metadata.");
  });
});
