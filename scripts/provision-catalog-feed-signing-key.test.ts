import { createPublicKey } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activateSigningKey,
  parseOptions,
  prepareSigningKey,
  type ConvexRunner,
} from "./provision-catalog-feed-signing-key";

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "clawhub-feed-key-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("catalog feed signing key provisioner", () => {
  it("parses explicit prepare and activate phases", () => {
    expect(
      parseOptions([
        "prepare",
        "--key-id",
        "clawhub-feed-2026-q4",
        "--public-key-out",
        "next.pem",
        "--prod",
      ]),
    ).toMatchObject({ command: "prepare", keyId: "clawhub-feed-2026-q4", target: "prod" });
    expect(
      parseOptions([
        "activate",
        "--key-id",
        "clawhub-feed-2026-q4",
        "--public-key",
        "next.pem",
        "--deployment",
        "staging",
      ]),
    ).toMatchObject({
      command: "activate",
      keyId: "clawhub-feed-2026-q4",
      target: { deployment: "staging" },
    });
  });

  it.each([
    [[]],
    [["prepare", "--key-id", "bad key", "--public-key-out", "next.pem", "--prod"]],
    [["prepare", "--key-id", "next", "--public-key-out", "next.pem"]],
    [
      [
        "activate",
        "--key-id",
        "next",
        "--public-key",
        "next.pem",
        "--prod",
        "--deployment",
        "staging",
      ],
    ],
  ])("rejects ambiguous or incomplete arguments: %j", (args) => {
    expect(() => parseOptions(args)).toThrow("Usage:");
  });

  it("prepares a pending key without changing the active signer", async () => {
    const directory = await temporaryDirectory();
    const publicKeyOut = join(directory, "next.pem");
    const runConvex = vi.fn<ConvexRunner>(() => "");

    await prepareSigningKey(
      { command: "prepare", keyId: "next", publicKeyOut, target: "prod" },
      { runConvex },
    );

    const [[args, config]] = runConvex.mock.calls;
    expect(args).toEqual(["env", "set", "CLAWHUB_FEED_SIGNING_PENDING_CONFIG", "--prod"]);
    expect(args).not.toContain("CLAWHUB_FEED_SIGNING_CONFIG");
    const parsed = JSON.parse(config ?? "") as { keyId: string; privateKey: string };
    expect(parsed.keyId).toBe("next");
    const writtenPublicKey = await readFile(publicKeyOut, "utf8");
    expect(createPublicKey(parsed.privateKey).export({ type: "spki", format: "pem" })).toBe(
      writtenPublicKey,
    );
  });

  it("retains the public recovery material when pending-secret storage fails", async () => {
    const directory = await temporaryDirectory();
    const publicKeyOut = join(directory, "next.pem");

    await expect(
      prepareSigningKey(
        { command: "prepare", keyId: "next", publicKeyOut, target: "prod" },
        {
          runConvex: () => {
            throw new Error("storage failed");
          },
        },
      ),
    ).rejects.toThrow("Pending-secret storage was not confirmed");
    expect(await readFile(publicKeyOut, "utf8")).toContain("BEGIN PUBLIC KEY");
  });

  it("activates only the pending key that matches the reviewed public key", async () => {
    const directory = await temporaryDirectory();
    const publicKey = join(directory, "next.pem");
    let pendingConfig = "";
    const prepareRunner: ConvexRunner = (_args, input) => {
      pendingConfig = input ?? "";
      return "";
    };
    await prepareSigningKey(
      { command: "prepare", keyId: "next", publicKeyOut: publicKey, target: "prod" },
      { runConvex: prepareRunner },
    );
    const calls: string[][] = [];
    const activateRunner: ConvexRunner = (args, input) => {
      calls.push(args);
      if (args[1] === "get") return pendingConfig;
      if (args[1] === "set") expect(input).toBe(pendingConfig);
      return "";
    };

    await activateSigningKey(
      { command: "activate", keyId: "next", publicKey, target: "prod" },
      { runConvex: activateRunner },
    );

    expect(calls).toEqual([
      ["env", "get", "CLAWHUB_FEED_SIGNING_PENDING_CONFIG", "--prod"],
      ["env", "set", "CLAWHUB_FEED_SIGNING_CONFIG", "--prod"],
      ["env", "remove", "CLAWHUB_FEED_SIGNING_PENDING_CONFIG", "--prod"],
    ]);
  });

  it("refuses activation when the reviewed public key does not match", async () => {
    const directory = await temporaryDirectory();
    const firstPublicKey = join(directory, "first.pem");
    const secondPublicKey = join(directory, "second.pem");
    let pendingConfig = "";
    await prepareSigningKey(
      { command: "prepare", keyId: "first", publicKeyOut: firstPublicKey, target: "prod" },
      { runConvex: (_args, input) => ((pendingConfig = input ?? ""), "") },
    );
    await prepareSigningKey(
      { command: "prepare", keyId: "second", publicKeyOut: secondPublicKey, target: "prod" },
      { runConvex: () => "" },
    );
    const runConvex = vi.fn<ConvexRunner>((args) => (args[1] === "get" ? pendingConfig : ""));

    await expect(
      activateSigningKey(
        { command: "activate", keyId: "first", publicKey: secondPublicKey, target: "prod" },
        { runConvex },
      ),
    ).rejects.toThrow("does not match the reviewed public key");
    expect(runConvex).toHaveBeenCalledTimes(1);
  });

  it("does not remove the pending key when active promotion fails", async () => {
    const directory = await temporaryDirectory();
    const publicKey = join(directory, "next.pem");
    let pendingConfig = "";
    await prepareSigningKey(
      { command: "prepare", keyId: "next", publicKeyOut: publicKey, target: "prod" },
      { runConvex: (_args, input) => ((pendingConfig = input ?? ""), "") },
    );
    const calls: string[][] = [];
    const runConvex: ConvexRunner = (args) => {
      calls.push(args);
      if (args[1] === "get") return pendingConfig;
      throw new Error("promotion failed");
    };

    await expect(
      activateSigningKey(
        { command: "activate", keyId: "next", publicKey, target: "prod" },
        { runConvex },
      ),
    ).rejects.toThrow("promotion failed");
    expect(calls.some((args) => args[1] === "remove")).toBe(false);
  });

  it("reports cleanup failure after activation without hiding the active write", async () => {
    const directory = await temporaryDirectory();
    const publicKey = join(directory, "next.pem");
    let pendingConfig = "";
    await prepareSigningKey(
      { command: "prepare", keyId: "next", publicKeyOut: publicKey, target: "prod" },
      { runConvex: (_args, input) => ((pendingConfig = input ?? ""), "") },
    );
    let activated = false;
    const runConvex: ConvexRunner = (args) => {
      if (args[1] === "get") return pendingConfig;
      if (args[1] === "set") {
        activated = true;
        return "";
      }
      throw new Error("cleanup failed");
    };

    await expect(
      activateSigningKey(
        { command: "activate", keyId: "next", publicKey, target: "prod" },
        { runConvex },
      ),
    ).rejects.toThrow("Signer activated, but pending-secret cleanup failed");
    expect(activated).toBe(true);
  });

  it("reports endpoint failure as post-activation verification", async () => {
    const directory = await temporaryDirectory();
    const publicKey = join(directory, "next.pem");
    let pendingConfig = "";
    await prepareSigningKey(
      { command: "prepare", keyId: "next", publicKeyOut: publicKey, target: "prod" },
      { runConvex: (_args, input) => ((pendingConfig = input ?? ""), "") },
    );
    const runConvex: ConvexRunner = (args) => (args[1] === "get" ? pendingConfig : "");

    await expect(
      activateSigningKey(
        {
          command: "activate",
          keyId: "next",
          publicKey,
          target: "prod",
          verifyUrl: "https://clawhub.ai/api/v1/feeds/plugins",
        },
        {
          runConvex,
          verifyFeed: async () => {
            throw new Error("HTTP 503");
          },
        },
      ),
    ).rejects.toThrow("Signer activated and pending secret removed");
  });
});
