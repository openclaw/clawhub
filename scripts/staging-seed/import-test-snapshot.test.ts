import { describe, expect, it } from "vitest";
import { CLAWHUB_TEST_DEPLOYMENT } from "../seed-test";
import {
  buildImportTestSnapshotCommand,
  parseImportTestSnapshotArgs,
} from "./import-test-snapshot";

describe("test snapshot import", () => {
  it("builds a replace-all import for the exact test deployment", () => {
    expect(buildImportTestSnapshotCommand("/tmp/test.zip", CLAWHUB_TEST_DEPLOYMENT)).toEqual({
      command: "bunx",
      args: [
        "convex",
        "import",
        "--deployment",
        CLAWHUB_TEST_DEPLOYMENT,
        "--replace-all",
        "-y",
        "/tmp/test.zip",
      ],
    });
  });

  it("requires a snapshot and rejects every other deployment", () => {
    expect(() => parseImportTestSnapshotArgs([])).toThrow("--snapshot is required");
    expect(() =>
      parseImportTestSnapshotArgs([
        "--snapshot",
        "/tmp/test.zip",
        "--deployment",
        "wry-manatee-359",
      ]),
    ).toThrow(`may only target ${CLAWHUB_TEST_DEPLOYMENT}`);
  });
});
