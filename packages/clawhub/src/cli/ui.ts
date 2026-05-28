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

const clawhubCrab = {
  interval: 110,
  frames: [
    "🦀      ",
    " 🦀     ",
    "  🦀    ",
    "   🦀   ",
    "    🦀  ",
    "     🦀 ",
    "      🦀",
    "     🦀 ",
    "    🦀  ",
    "   🦀   ",
    "  🦀    ",
    " 🦀     ",
  ],
};

type CrabLoader = {
  text: string;
  readonly isSpinning: boolean;
  start(text?: string): CrabLoader;
  stop(): CrabLoader;
  succeed(text?: string): CrabLoader;
  fail(text?: string): CrabLoader;
};

function createNonInteractiveCrabLoader(text: string): CrabLoader {
  let currentText = text;
  const loader = {
    get text() {
      return currentText;
    },
    set text(value: string) {
      currentText = value;
    },
    get isSpinning() {
      return false;
    },
    start(value?: string) {
      if (value) currentText = value;
      return loader;
    },
    stop() {
      return loader;
    },
    succeed(value?: string) {
      if (value) console.log(value);
      return loader;
    },
    fail(value?: string) {
      if (value) console.error(value);
      return loader;
    },
  };
  return loader;
}

export function createCrabLoader(text: string): CrabLoader {
  if (!isInteractive()) return createNonInteractiveCrabLoader(text);
  return ora({ text, spinner: clawhubCrab, color: "red" }).start();
}

export function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isStdoutColorEnabled() {
  if (!process.stdout.isTTY) return false;
  if (process.env.NO_COLOR) return false;
  return true;
}

const textStyles = {
  brand: "\x1b[1m\x1b[31m",
  strong: "\x1b[1m",
  muted: "\x1b[2m",
};

export function styleText(value: string, style: keyof typeof textStyles) {
  if (!isStdoutColorEnabled()) return value;
  return `${textStyles[style]}${value}\x1b[0m`;
}

function isErrorColorEnabled() {
  if (!process.stderr.isTTY) return false;
  if (process.env.NO_COLOR) return false;
  return true;
}

function formatErrorLabel() {
  if (!isErrorColorEnabled()) return "Error:";
  return "\x1b[1m\x1b[31mError:\x1b[0m";
}

export function fail(message: string): never {
  console.error(`${formatErrorLabel()} ${message}`);
  process.exit(1);
}
