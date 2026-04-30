import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const storageData = new WeakMap<Storage, Map<string, string>>();

function getStorageData(storage: Storage) {
  let data = storageData.get(storage);
  if (!data) {
    data = new Map();
    storageData.set(storage, data);
  }
  return data;
}

function installLocalStorageShim() {
  if (typeof window === "undefined" || typeof Storage === "undefined") return;
  if (typeof window.localStorage?.clear === "function") return;

  Object.defineProperties(Storage.prototype, {
    length: {
      configurable: true,
      get() {
        return getStorageData(this as Storage).size;
      },
    },
    clear: {
      configurable: true,
      value() {
        getStorageData(this as Storage).clear();
      },
    },
    getItem: {
      configurable: true,
      value(key: string) {
        return getStorageData(this as Storage).get(String(key)) ?? null;
      },
    },
    key: {
      configurable: true,
      value(index: number) {
        return Array.from(getStorageData(this as Storage).keys())[index] ?? null;
      },
    },
    removeItem: {
      configurable: true,
      value(key: string) {
        getStorageData(this as Storage).delete(String(key));
      },
    },
    setItem: {
      configurable: true,
      value(key: string, value: string) {
        getStorageData(this as Storage).set(String(key), String(value));
      },
    },
  });

  const localStorage = Object.create(Storage.prototype) as Storage;
  storageData.set(localStorage, new Map());
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorage,
  });
}

installLocalStorageShim();

function proxyReactInternals() {
  try {
    const rootReact = require("react");
    const testingLibraryRequire = createRequire(require.resolve("@testing-library/react"));
    const rendererReact = testingLibraryRequire("react");
    const rootInternals = rootReact.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    const rendererInternals =
      rendererReact.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    if (!rootInternals || !rendererInternals || rootInternals === rendererInternals) return;

    for (const key of ["H", "A", "T", "S", "V"] as const) {
      Object.defineProperty(rootInternals, key, {
        configurable: true,
        get() {
          return rendererInternals[key];
        },
        set(value) {
          rendererInternals[key] = value;
        },
      });
    }
  } catch {
    // Best effort for package-manager layouts that install duplicate React copies.
  }
}

proxyReactInternals();
