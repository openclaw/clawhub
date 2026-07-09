import { describe, expect, it } from "vitest";
import {
  dummyIdentity,
  isPublicPackageSnapshot,
  isPublicSkillSnapshot,
  publicSkillFields,
  publicSkillVersionFields,
  sanitizeDerivedSnapshot,
  sanitizeJsonValue,
  sanitizePublisherSnapshot,
  sanitizePublicText,
  sanitizeUserSnapshot,
  selectPackageSnapshotFiles,
  selectSkillSnapshotFiles,
  type SnapshotDocument,
} from "./snapshotPolicy";

const base = {
  _id: "users:abc123",
  _creationTime: 1,
} satisfies SnapshotDocument;

describe("staging snapshot policy", () => {
  it("keeps only public catalog rows", () => {
    expect(isPublicSkillSnapshot({ ...base, moderationStatus: "active" })).toBe(true);
    expect(isPublicSkillSnapshot({ ...base, moderationStatus: "hidden" })).toBe(false);
    expect(isPublicSkillSnapshot({ ...base, moderationVerdict: "malicious" })).toBe(false);
    expect(
      isPublicPackageSnapshot({
        ...base,
        family: "code-plugin",
        channel: "community",
        scanStatus: "clean",
      }),
    ).toBe(true);
    expect(
      isPublicPackageSnapshot({
        ...base,
        family: "code-plugin",
        channel: "private",
      }),
    ).toBe(false);
  });

  it("replaces owner identity while preserving relationship ids", () => {
    const user = sanitizeUserSnapshot(
      {
        ...base,
        email: "person@example.com",
        handle: "real-person",
        personalPublisherId: "publishers:one",
      },
      new Set(["publishers:one"]),
    );
    expect(user).toMatchObject({
      _id: base._id,
      personalPublisherId: "publishers:one",
      role: "user",
    });
    expect(user.handle).toBe(dummyIdentity(base._id, "user").handle);
    expect(user).not.toHaveProperty("email");

    const publisher = sanitizePublisherSnapshot(
      {
        ...base,
        _id: "publishers:one",
        kind: "user",
        linkedUserId: base._id,
        bio: "private biography",
      },
      new Set([base._id]),
    );
    expect(publisher).toMatchObject({
      _id: "publishers:one",
      linkedUserId: base._id,
    });
    expect(publisher).not.toHaveProperty("bio");
  });

  it("redacts secrets, emails, and local paths from public artifacts", () => {
    const redacted = sanitizePublicText(
      "email person@example.com token=supersecretvalue123 /Users/patrick/private.txt",
    );
    expect(redacted).toContain("[REDACTED_SECRET]");
    expect(redacted).toContain("[REDACTED_PATH]");
    expect(redacted).not.toContain("person@example.com");
    expect(redacted).not.toContain("supersecretvalue123");
    expect(redacted).not.toContain("patrick/private.txt");
    expect(redacted).not.toContain("private.txt");
    expect(
      sanitizePublicText("path=/Users/patrick/My Private Project/config.json then continue"),
    ).toBe("path=[REDACTED_PATH]");
  });

  it("drops private-looking metadata keys recursively", () => {
    expect(
      sanitizeJsonValue({
        description: "public",
        email: "person@example.com",
        nested: { apiToken: "secret-token-value", label: "safe" },
      }),
    ).toEqual({
      description: "public",
      nested: { label: "safe" },
    });
  });

  it("allowlists public skill fields", () => {
    const skill = publicSkillFields({
      ...base,
      _id: "skills:one",
      slug: "demo",
      displayName: "Demo",
      ownerUserId: base._id,
      latestVersionId: "skillVersions:one",
      tags: { latest: "skillVersions:one", beta: "skillVersions:old" },
      badges: { official: { byUserId: "users:staff", at: 1 } },
      moderationStatus: "active",
      moderationNotes: "private note",
      reportCount: 9,
    });
    expect(skill).toMatchObject({
      _id: "skills:one",
      tags: { latest: "skillVersions:one" },
      batch: "staging-prod-snapshot-v1",
    });
    expect(skill).not.toHaveProperty("moderationNotes");
    expect(skill).not.toHaveProperty("reportCount");
    expect(skill).not.toHaveProperty("badges");
  });

  it("keeps only the current public artifact surface", () => {
    const files = [
      {
        path: "SKILL.md",
        size: 100,
        storageId: "storage:skill",
        sha256: "skill",
      },
      {
        path: "private.bin",
        size: 100,
        storageId: "storage:private",
        sha256: "private",
      },
    ];
    expect(selectSkillSnapshotFiles(files)).toEqual([files[0]]);

    expect(
      selectPackageSnapshotFiles([
        ...files,
        {
          path: "package.json",
          size: 100,
          storageId: "storage:package",
          sha256: "package",
        },
        {
          path: "src/index.ts",
          size: 100,
          storageId: "storage:index",
          sha256: "index",
        },
        {
          path: "skills/demo/SKILL.md",
          size: 100,
          storageId: "storage:bundled-skill",
          sha256: "bundled-skill",
        },
      ]).map((file) => file.path),
    ).toEqual(["package.json", "SKILL.md", "skills/demo/SKILL.md"]);
  });

  it("replaces owner display fields and stale references in derived rows", () => {
    const parent = {
      ...base,
      _id: "skills:one",
      ownerPublisherId: "publishers:one",
      latestVersionId: "skillVersions:latest",
    };
    const digest = sanitizeDerivedSnapshot(
      {
        ...base,
        _id: "digest:one",
        skillId: parent._id,
        ownerHandle: "real-handle",
        ownerName: "Real Name",
        ownerDisplayName: "Real Display Name",
        ownerImage: "https://example.com/real.png",
        badges: { official: { byUserId: "users:staff", at: 1 } },
        latestVersionId: "skillVersions:old",
        latestVersionSkillId: "skills:old",
        tags: { latest: "skillVersions:old" },
      },
      parent,
      "skill",
    );
    const owner = dummyIdentity("publishers:one", "publisher");
    expect(digest).toMatchObject({
      ownerHandle: owner.handle,
      ownerName: owner.displayName,
      ownerDisplayName: owner.displayName,
      ownerImage: owner.image,
      latestVersionId: "skillVersions:latest",
      latestVersionSkillId: "skills:one",
      tags: { latest: "skillVersions:latest" },
    });
    expect(digest).not.toHaveProperty("badges");
  });

  it("reassigns version creation to the dummy owner and drops scan internals", () => {
    const version = publicSkillVersionFields(
      {
        ...base,
        _id: "skillVersions:one",
        skillId: "skills:one",
        version: "1.0.0",
        changelog: "hello",
        parsed: { frontmatter: { email: "person@example.com", name: "demo" } },
        createdBy: "users:real",
        staticScan: { findings: ["private"] },
      },
      "users:dummy",
      [],
    );
    expect(version).toMatchObject({
      createdBy: "users:dummy",
      parsed: { frontmatter: { name: "demo" } },
    });
    expect(version).not.toHaveProperty("staticScan");
  });
});
