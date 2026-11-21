import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import tls from "node:tls";

export function assertFixtureHome() {
  const directory = process.env.CLAWHUB_DEPENDENCY_FIXTURE_HOME;
  const nonce = process.env.CLAWHUB_DEPENDENCY_FIXTURE_NONCE;
  assert.ok(
    directory && /^[a-f0-9]{64}$/.test(nonce ?? ""),
    "Run through the dependency fixture runner.",
  );
  const home = realpathSync(directory);
  assert.equal(realpathSync(homedir()), home, "Fixture HOME must match its declared directory.");
  assert.equal(realpathSync(process.cwd()), home, "Fixture cwd must match its HOME.");
  assert.ok(basename(home).startsWith("dependency-compat-"), "Unexpected fixture directory.");
  const marker = join(home, ".clawhub-dependency-fixture");
  const info = lstatSync(marker);
  assert.ok(info.isFile() && !info.isSymbolicLink(), "Missing fixture ownership marker.");
  if (process.getuid) assert.equal(info.uid, process.getuid(), "Fixture marker has another owner.");
  assert.equal(readFileSync(marker, "utf8"), nonce, "Fixture ownership marker mismatch.");
}

export function rejectExternalIo(fetchFixture) {
  let unexpected = 0;
  const reject = () => {
    unexpected++;
    throw new Error("Unexpected network or subprocess in dependency fixture.");
  };
  http.request = http.get = https.request = https.get = reject;
  net.connect = net.createConnection = tls.connect = reject;
  net.Socket.prototype.connect = reject;
  childProcess.fork = reject;
  childProcess.spawn = childProcess.spawnSync = reject;
  childProcess.exec = childProcess.execSync = reject;
  childProcess.execFile = childProcess.execFileSync = reject;
  globalThis.fetch = async (...args) => {
    const response = await fetchFixture?.(...args);
    return response ?? reject();
  };
  return () => {
    if (unexpected) throw new Error(`${unexpected} unexpected external operations.`);
  };
}
