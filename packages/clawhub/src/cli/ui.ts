import { spawn } from "node:child_process";
import { stdin } from "node:process";
import { confirm, isCancel } from "@clack/prompts";
import ora from "ora";

export async function promptHidden(prompt: string) {
  if (!stdin.isTTY) return "";
  process.stdout.write(prompt);
  const chunks: Buffer[] = [];
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise<string>((resolvePromise) => {
    function onData(data: Buffer) {
      const text = data.toString("utf8");
      if (text === "\r" || text === "\n") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        process.stdout.write("\n");
        resolvePromise(Buffer.concat(chunks).toString("utf8").trim());
        return;
      }
      if (text === "\u0003") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        process.stdout.write("\n");
        fail("Canceled");
      }
      if (text === "\u007f") {
        chunks.pop();
        return;
      }
      chunks.push(data);
    }
    stdin.on("data", onData);
  });
}

export async function promptConfirm(prompt: string) {
  const answer = await confirm({ message: prompt });
  if (isCancel(answer)) return false;
  return answer;
}

export function openInBrowser(url: string) {
  const args =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["explorer", url]
        : ["xdg-open", url];
  const [command, ...commandArgs] = args;
  if (!command) return;

  const child = spawn(command, commandArgs, { stdio: "ignore", detached: true });

  child.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.log("");
      console.log("Could not open browser automatically.");
      console.log("Please open this URL manually:");
      console.log("");
      console.log(`  ${url}`);
      console.log("");
    }
  });

  child.unref();
}

export function isInteractive() {
  return process.stdout.isTTY && stdin.isTTY;
}

export function createSpinner(text: string) {
  return ora({ text, spinner: "dots", isEnabled: isInteractive() }).start();
}

export function escapeTerminalControlCharacters(value: string) {
  let escaped = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if ((code >= 0 && code <= 31) || (code >= 127 && code <= 159) || isBidiControlCode(code)) {
      if (character === "\n") {
        escaped += "\\n";
      } else if (character === "\r") {
        escaped += "\\r";
      } else if (character === "\t") {
        escaped += "\\t";
      } else if (code > 255) {
        escaped += `\\u${code.toString(16).padStart(4, "0")}`;
      } else {
        escaped += `\\x${code.toString(16).padStart(2, "0")}`;
      }
    } else {
      escaped += character;
    }
  }
  return escaped;
}

export function formatError(error: unknown) {
  return escapeTerminalControlCharacters(error instanceof Error ? error.message : String(error));
}

export function fail(message: string): never {
  console.error(`Error: ${escapeTerminalControlCharacters(message)}`);
  process.exit(1);
}

function isBidiControlCode(code: number) {
  return (
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}
