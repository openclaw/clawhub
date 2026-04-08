export function createGlobalStubRegistry() {
  const restorers: Array<() => void> = [];

  return {
    stub<K extends keyof typeof globalThis>(name: K, value: (typeof globalThis)[K]) {
      const original = globalThis[name];
      restorers.push(() => {
        if (original === undefined) {
          Reflect.deleteProperty(globalThis, name);
          return;
        }
        Object.defineProperty(globalThis, name, {
          configurable: true,
          writable: true,
          value: original,
        });
      });
      Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value,
      });
    },
    restoreAll() {
      while (restorers.length > 0) {
        restorers.pop()?.();
      }
    },
  };
}

export function createEnvStubRegistry() {
  const restorers: Array<() => void> = [];

  return {
    stub(name: string, value: string) {
      const original = process.env[name];
      const hadOriginal = Object.prototype.hasOwnProperty.call(process.env, name);
      restorers.push(() => {
        if (hadOriginal) {
          process.env[name] = original;
          return;
        }
        delete process.env[name];
      });
      process.env[name] = value;
    },
    restoreAll() {
      while (restorers.length > 0) {
        restorers.pop()?.();
      }
    },
  };
}
