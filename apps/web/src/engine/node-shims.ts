/**
 * mdb-reader's decryption dependencies (browserify-aes → readable-stream) read Node's
 * `process` global (process.nextTick, process.env) when they load. The worker gets a
 * minimal stand-in before any of them is imported. Buffer is installed by the engine
 * (ensureBuffer) when it needs it.
 */
const g = globalThis as { process?: unknown };
if (!g.process) {
  g.process = {
    browser: true,
    env: {},
    version: '',
    versions: {},
    nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
      queueMicrotask(() => fn(...args)),
  };
}

export {};
