import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTestTempDirectories(defaultPrefix: string) {
  const directories: string[] = [];
  return {
    async create(prefix = defaultPrefix) {
      const directory = await mkdtemp(join(tmpdir(), prefix));
      directories.push(directory);
      return directory;
    },
    track(directory: string) {
      directories.push(directory);
    },
    async cleanup() {
      await Promise.all(
        directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
      );
    },
  };
}
