/* @vitest-environment node */

import { accessSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalAuthTempDir } from "./playwright-local-auth-config";

vi.mock("node:fs", () => ({
  constants: { W_OK: 2, X_OK: 1 },
  accessSync: vi.fn(),
  mkdtempSync: vi.fn(),
  statSync: vi.fn(),
}));
vi.mock("node:os", () => ({ tmpdir: vi.fn() }));

describe("local-auth disposable scratch", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(process, "cwd").mockReturnValue("/home/developer/project");
    vi.mocked(tmpdir).mockReturnValue("/tmp");
    vi.mocked(statSync).mockImplementation(
      (path) => ({ dev: String(path).startsWith("/home") ? 2 : 1 }) as ReturnType<typeof statSync>,
    );
    vi.mocked(mkdtempSync).mockImplementation((prefix) => {
      if (String(prefix).startsWith("/home/clawhub-"))
        throw Object.assign(new Error("mount root is read-only"), { code: "EACCES" });
      return `${prefix}fixture`;
    });
    vi.mocked(accessSync).mockImplementation((path) => {
      if (path === "/home")
        throw Object.assign(new Error("mount root is read-only"), { code: "EACCES" });
    });
  });

  it.each(["EACCES", "EPERM", "EROFS"])(
    "uses a writable user directory when the mount root rejects access with %s",
    (code) => {
      vi.mocked(accessSync).mockImplementation((path) => {
        if (path === "/home")
          throw Object.assign(new Error("mount root is not writable"), { code });
      });
      expect(createLocalAuthTempDir()).toBe("/home/developer/clawhub-pw-fixture");
      expect(mkdtempSync).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps the configured temporary directory when it is on the workspace volume", () => {
    vi.mocked(tmpdir).mockReturnValue("/home/developer/tmp");
    expect(createLocalAuthTempDir()).toBe("/home/developer/tmp/clawhub-pw-fixture");
    expect(accessSync).not.toHaveBeenCalled();
  });
});
