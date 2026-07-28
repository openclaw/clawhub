function readString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readProcessEnv(name: string) {
  if (typeof process === "undefined") return undefined;
  return readString(process.env?.[name]);
}

function readMetaEnv(name: string) {
  return readString((import.meta.env as Record<string, unknown>)[name]);
}

export function getRuntimeEnv(name: string) {
  const bundledValue = readMetaEnv(name);
  const preferBundledValue =
    typeof window !== "undefined" ||
    (name.startsWith("VITE_") && readMetaEnv("VITE_CLAWHUB_DEPLOY_ENV") === "preview");
  if (preferBundledValue) {
    return bundledValue ?? readProcessEnv(name);
  }
  return readProcessEnv(name) ?? bundledValue;
}

export function getRequiredRuntimeEnv(name: string) {
  const value = getRuntimeEnv(name);
  if (value) return value;
  throw new Error(`Missing required environment variable: ${name}`);
}

export function isDevRuntime() {
  const nodeEnv = readProcessEnv("NODE_ENV");
  if (nodeEnv) {
    return nodeEnv !== "production";
  }
  return import.meta.env.DEV;
}
