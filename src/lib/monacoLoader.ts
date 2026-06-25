import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

type MonacoWindow = Window &
  typeof globalThis & {
    MonacoEnvironment?: {
      getWorker: () => Worker;
    };
  };

const browserWindow = typeof window !== "undefined" ? (window as MonacoWindow) : undefined;

if (browserWindow && !browserWindow.MonacoEnvironment) {
  browserWindow.MonacoEnvironment = {
    getWorker() {
      return new editorWorker();
    },
  };
}

loader.config({ monaco });

let initPromise: Promise<void> | null = null;

export function ensureMonacoLoader() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Monaco loader is only available in the browser"));
  }
  if (!initPromise) {
    initPromise = loader.init().then(() => undefined);
  }
  return initPromise;
}
