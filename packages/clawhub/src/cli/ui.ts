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

export function formatError(error: unknown) {
  if (error instanceof Error) {
    const diagnostic = formatTransportError(error);
    if (diagnostic) return diagnostic;
    return redactSensitiveText(error.message);
  }
  return String(error);
}

export function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function formatTransportError(error: Error) {
  const chain = errorChain(error);
  const messages = chain
    .map((entry) => entry.message)
    .filter((message) => message.trim().length > 0);
  const codes = chain.map((entry) => entry.code).filter((code): code is string => Boolean(code));
  const combined = [...messages, ...codes].join("\n");
  if (!isTransportError(combined)) return null;

  const sanitized = redactSensitiveText(messages.join(": "));
  const reason = classifyTransportError(combined);
  const detail = sanitized.length > 0 ? ` ${sanitized}` : "";
  return `${reason}${detail}\nCheck the registry URL, network connection, proxy settings (HTTPS_PROXY, HTTP_PROXY, NO_PROXY), and TLS/certificate configuration.`;
}

function errorChain(error: Error) {
  const entries: Array<{ message: string; code?: string }> = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    entries.push({ message: current.message, code: errorCode(current) });
    current = current.cause;
  }

  if (current !== undefined && current !== null && !seen.has(current)) {
    entries.push({ message: formatUnknownCause(current) });
  }

  return entries;
}

function formatUnknownCause(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return String(value);
}

function errorCode(error: Error) {
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" ? code : undefined;
}

function isTransportError(value: string) {
  return /fetch failed|failed to fetch|curl failed|request timed out|aborted|aborterror|enotfound|eai_again|econnrefused|econnreset|etimedout|ehostunreach|enetunreach|cert_|certificate|tls|ssl|proxy|connect tunnel|could not resolve host|operation timed out/i.test(
    value,
  );
}

function classifyTransportError(value: string) {
  if (/enotfound|eai_again|could not resolve host/i.test(value)) {
    return "Network request failed: DNS lookup failed.";
  }
  if (/request timed out|etimedout|operation timed out|aborterror|aborted/i.test(value)) {
    return "Network request failed: the request timed out.";
  }
  if (/cert_|certificate|tls|ssl/i.test(value)) {
    return "Network request failed: TLS or certificate validation failed.";
  }
  if (/proxy|connect tunnel/i.test(value)) {
    return "Network request failed: proxy connection failed.";
  }
  if (/econnrefused|ehostunreach|enetunreach/i.test(value)) {
    return "Network request failed: the registry was unreachable.";
  }
  return "Network request failed.";
}

function redactSensitiveText(value: string) {
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(authorization:\s*)(?!bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(clh_[A-Za-z0-9._-]+)/g, "[redacted]")
    .replace(
      /([?&](?:access_token|api[_-]?key|auth|authorization|callback|callback_url|code|key|redirect_uri|return_to|secret|state|token)=)[^&#\s]+/gi,
      "$1[redacted]",
    )
    .replace(/:\/\/[^/\s:@]+:[^/\s@]+@/g, "://[redacted]@");
}
