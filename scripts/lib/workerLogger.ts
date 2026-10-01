import pino, { type DestinationStream, type Logger } from "pino";

export const WORKER_LOG_REDACTION_PATHS = [
  "token",
  "secret",
  "password",
  "apiKey",
  "api_key",
  "authorization",
  "Authorization",
  "headers.authorization",
  "headers.Authorization",
  "request.headers.authorization",
  "request.headers.Authorization",
  "artifact.url",
  "artifact.downloadUrl",
  "artifact.clawpackUrl",
  "artifact.signedUrl",
  "artifacts[*].url",
  "target.files[*].url",
  "target.clawpackUrl",
  "url",
  "downloadUrl",
  "clawpackUrl",
  "signedUrl",
  "error",
  "reason",
  "err.message",
  "err.stack",
  "stderr",
  "stdout",
  "rawResult",
] as const;

function stdoutDestination(): DestinationStream {
  return {
    write(line: string) {
      process.stdout.write(line);
    },
  };
}

export function createWorkerLogger(options?: {
  destination?: DestinationStream;
  level?: string;
  name: string;
}): Logger {
  return pino(
    {
      base: { service: options?.name },
      level: options?.level ?? process.env.WORKER_LOG_LEVEL ?? "info",
      redact: {
        censor: "[redacted-secret]",
        paths: [...WORKER_LOG_REDACTION_PATHS],
      },
    },
    options?.destination ?? stdoutDestination(),
  );
}
