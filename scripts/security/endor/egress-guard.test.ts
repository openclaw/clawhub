/* @vitest-environment node */
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const guardScript = fileURLToPath(new URL("./egress-guard.sh", import.meta.url));
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Endor container egress guard", () => {
  it("rejects private, link-local, and special-use IPv4 and IPv6 destinations", async () => {
    const root = await mkdtemp(join(tmpdir(), "clawhub-endor-egress-guard-"));
    directories.push(root);
    const bin = join(root, "bin");
    const log = join(root, "iptables.log");
    await mkdir(bin);
    for (const command of ["id", "iptables", "ip6tables"]) {
      const body =
        command === "id"
          ? 'printf "0\\n"\n'
          : 'printf "%s %s\\n" "${0##*/}" "$*" >> "$GUARD_LOG"\n';
      const path = join(bin, command);
      await writeFile(path, `#!/bin/sh\n${body}`);
      await chmod(path, 0o755);
    }

    execFileSync("/bin/sh", [guardScript], {
      env: { GUARD_LOG: log, PATH: `${bin}:/usr/bin:/bin` },
    });
    const rules = (await readFile(log, "utf8")).trim().split("\n");
    expect(rules).toContain("iptables -w -I OUTPUT 1 -d 169.254.0.0/16 -j REJECT");
    expect(rules).toContain("iptables -w -I OUTPUT 1 -d 172.16.0.0/12 -j REJECT");
    expect(rules).toContain("iptables -w -I OUTPUT 1 -d 100.64.0.0/10 -j REJECT");
    expect(rules).toContain("ip6tables -w -I OUTPUT 1 -d fc00::/7 -j REJECT");
    expect(rules).toContain("ip6tables -w -I OUTPUT 1 -d fe80::/10 -j REJECT");
    expect(rules).toContain("ip6tables -w -I OUTPUT 1 -d ::ffff:0:0/96 -j REJECT");
    expect(rules).toHaveLength(26);
  });
});
