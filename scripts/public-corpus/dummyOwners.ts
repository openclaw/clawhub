import { createHash } from "node:crypto";
import { faker } from "@faker-js/faker";

export type DummyCorpusOwner = {
  handle: string;
  displayName: string;
  image: string;
};

const DEFAULT_OWNER_SEED = 20260513;
const DEFAULT_OWNER_COUNT = 24;

export function buildDummyOwnerPool(count = DEFAULT_OWNER_COUNT): DummyCorpusOwner[] {
  faker.seed(DEFAULT_OWNER_SEED);
  const owners: DummyCorpusOwner[] = [];
  const handles = new Set<string>();

  while (owners.length < count) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const displayName = `${firstName} ${lastName}`;
    const baseHandle = slugify(displayName);
    const handle = uniqueHandle(baseHandle, handles);
    owners.push({
      handle,
      displayName,
      image: `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(handle)}`,
    });
  }

  return owners;
}

export function ownerForCorpusKey(key: string, owners = buildDummyOwnerPool()): DummyCorpusOwner {
  if (owners.length === 0) throw new Error("Dummy owner pool must not be empty.");
  const digest = createHash("sha256").update(key).digest("hex");
  const index = Number.parseInt(digest.slice(0, 8), 16) % owners.length;
  return owners[index]!;
}

function uniqueHandle(baseHandle: string, handles: Set<string>) {
  let handle = `local-corpus-${baseHandle}`;
  let suffix = 2;
  while (handles.has(handle)) {
    handle = `local-corpus-${baseHandle}-${suffix}`;
    suffix += 1;
  }
  handles.add(handle);
  return handle;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
