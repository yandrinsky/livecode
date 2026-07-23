export function createCodeWorkerSource(compiledCode: string) {
  return `
const nativeSetTimeout = self.setTimeout.bind(self);
const nativeClearTimeout = self.clearTimeout.bind(self);
const nativeSetInterval = self.setInterval.bind(self);
const nativeClearInterval = self.clearInterval.bind(self);
const timeoutTasks = new Set();
const intervalTasks = new Set();
let pendingTasks = 0;
let sourceFinished = false;
let finished = false;
let idleTimer = null;

const quoteString = (value) => "'" + value
  .replaceAll("\\\\", "\\\\\\\\")
  .replaceAll("'", "\\\\'")
  .replaceAll("\\n", "\\\\n")
  .replaceAll("\\r", "\\\\r")
  .replaceAll("\\t", "\\\\t") + "'";

const formatValue = (value, nested = false, depth = 0, ancestors = new WeakSet()) => {
  if (typeof value === "string") return nested ? quoteString(value) : value;
  if (typeof value === "function") return "[Function" + (value.name ? ": " + value.name : "") + "]";
  if (typeof value === "symbol") return String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (value === null || typeof value !== "object") return String(value);
  if (value instanceof Error) return value.stack || value.name + ": " + value.message;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  if (value instanceof RegExp) return String(value);
  if (ancestors.has(value)) return "[Circular]";
  if (depth >= 5) return Array.isArray(value) ? "[Array(" + value.length + ")]" : "[Object]";

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.slice(0, 100).map((item) => formatValue(item, true, depth + 1, ancestors));
      if (value.length > 100) items.push("... " + (value.length - 100) + " more items");
      return "[ " + items.join(", ") + " ]";
    }

    const keys = Reflect.ownKeys(value).filter((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && descriptor.enumerable;
    });
    const properties = keys.slice(0, 100).map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      const label = typeof key === "symbol"
        ? "[" + String(key) + "]"
        : /^[A-Za-z_$][\\w$]*$/.test(key) ? key : quoteString(key);
      if (!descriptor) return label + ": undefined";
      if (descriptor.get && !Object.prototype.hasOwnProperty.call(descriptor, "value")) return label + ": [Getter]";
      return label + ": " + formatValue(descriptor.value, true, depth + 1, ancestors);
    });
    if (keys.length > 100) properties.push("... " + (keys.length - 100) + " more properties");
    const constructorName = value.constructor && value.constructor !== Object ? value.constructor.name : "";
    return (constructorName ? constructorName + " " : "") + "{ " + properties.join(", ") + " }";
  } catch {
    return Object.prototype.toString.call(value);
  } finally {
    ancestors.delete(value);
  }
};

const emitLog = (...args) => postMessage({ type: "log", value: args.map(formatValue).join(" ") });
console.log = emitLog;
console.info = emitLog;
console.warn = emitLog;
console.error = emitLog;

const consoleTimers = new Map();
const timerLabel = (label = "default") => String(label);
const timerDuration = (startedAt) => (performance.now() - startedAt).toFixed(3) + "ms";

console.time = (label = "default") => {
  const name = timerLabel(label);
  if (consoleTimers.has(name)) {
    emitLog("Timer '" + name + "' already exists");
    return;
  }
  consoleTimers.set(name, performance.now());
};

console.timeLog = (label = "default", ...args) => {
  const name = timerLabel(label);
  const startedAt = consoleTimers.get(name);
  if (startedAt === undefined) {
    emitLog("Timer '" + name + "' does not exist");
    return;
  }
  emitLog(name + ": " + timerDuration(startedAt), ...args);
};

console.timeEnd = (label = "default") => {
  const name = timerLabel(label);
  const startedAt = consoleTimers.get(name);
  if (startedAt === undefined) {
    emitLog("Timer '" + name + "' does not exist");
    return;
  }
  consoleTimers.delete(name);
  emitLog(name + ": " + timerDuration(startedAt));
};

const reportError = (error) => {
  if (finished) return;
  finished = true;
  if (idleTimer !== null) nativeClearTimeout(idleTimer);
  postMessage({ type: "error", value: formatValue(error) });
};

const scheduleDone = () => {
  if (finished || !sourceFinished || pendingTasks !== 0 || idleTimer !== null) return;
  idleTimer = nativeSetTimeout(() => {
    idleTimer = null;
    if (finished || !sourceFinished || pendingTasks !== 0) return;
    finished = true;
    postMessage({ type: "done" });
  }, 0);
};

const beginTask = () => {
  pendingTasks += 1;
  if (idleTimer !== null) {
    nativeClearTimeout(idleTimer);
    idleTimer = null;
  }
};

const finishTask = () => {
  pendingTasks = Math.max(0, pendingTasks - 1);
  scheduleDone();
};

self.setTimeout = (callback, delay = 0, ...args) => {
  beginTask();
  let handle;
  handle = nativeSetTimeout(() => {
    if (!timeoutTasks.delete(handle)) return;
    try {
      callback(...args);
    } catch (error) {
      reportError(error);
    } finally {
      finishTask();
    }
  }, delay);
  timeoutTasks.add(handle);
  return handle;
};

self.clearTimeout = (handle) => {
  if (timeoutTasks.delete(handle)) finishTask();
  nativeClearTimeout(handle);
};

self.setInterval = (callback, delay = 0, ...args) => {
  beginTask();
  const handle = nativeSetInterval(() => {
    try {
      callback(...args);
    } catch (error) {
      reportError(error);
    }
  }, delay);
  intervalTasks.add(handle);
  return handle;
};

self.clearInterval = (handle) => {
  if (intervalTasks.delete(handle)) finishTask();
  nativeClearInterval(handle);
};

if (typeof self.fetch === "function") {
  const nativeFetch = self.fetch.bind(self);
  self.fetch = (...args) => {
    beginTask();
    try {
      return nativeFetch(...args).finally(finishTask);
    } catch (error) {
      finishTask();
      throw error;
    }
  };
}

self.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  reportError(event.reason);
});

self.addEventListener("error", (event) => {
  event.preventDefault();
  reportError(event.error || event.message);
});

const exports = {};
const module = { exports };

(async () => {
  try {
    await (async () => {
${compiledCode}
    })();
    sourceFinished = true;
    scheduleDone();
  } catch (error) {
    reportError(error);
  }
})();
`;
}
