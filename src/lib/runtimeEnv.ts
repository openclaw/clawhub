function readString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readProcessEnv(name: string) {
  if (typeof process === "undefined") return undefined;
  return readString(process.env?.[name]);
}

function readClientMetaEnv(name: string) {
  if (typeof window === "undefined") return undefined;
  return readString((import.meta.env as Record<string, unknown>)[name]);
}

export function getRuntimeEnv(name: string) {
  return readProcessEnv(name) ?? readClientMetaEnv(name);
}

export function getRequiredRuntimeEnv(name: string) {
  const value = getRuntimeEnv(name);
  if (value) return value;
  throw new Error(`Missing required environment variable: ${name}`);
}

export function isDevRuntime() {
  if (typeof window === "undefined") {
    return process.env.NODE_ENV !== "production";
  }
  return Boolean(import.meta.env.DEV);
}
