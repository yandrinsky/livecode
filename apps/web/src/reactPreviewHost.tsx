import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
import * as jsxRuntime from "react/jsx-runtime";

type PreviewWindow = Window & typeof globalThis & {
  __PAIRBOARD_REACT__: typeof React;
  __PAIRBOARD_REACT_DOM__: typeof ReactDOM;
  __PAIRBOARD_REACT_DOM_CLIENT__: typeof ReactDOMClient;
  __PAIRBOARD_JSX_RUNTIME__: typeof jsxRuntime;
  __PAIRBOARD_JSX_DEV_RUNTIME__: typeof jsxDevRuntime;
};

const previewWindow = window as PreviewWindow;
previewWindow.__PAIRBOARD_REACT__ = React;
previewWindow.__PAIRBOARD_REACT_DOM__ = ReactDOM;
previewWindow.__PAIRBOARD_REACT_DOM_CLIENT__ = ReactDOMClient;
previewWindow.__PAIRBOARD_JSX_RUNTIME__ = jsxRuntime;
previewWindow.__PAIRBOARD_JSX_DEV_RUNTIME__ = jsxDevRuntime;

const channel = new URLSearchParams(location.search).get("channel") ?? "";
const send = (type: string, value?: string) => parent.postMessage({ source: "pairboard-react-preview", channel, type, value }, "*");

function printable(value: unknown, seen = new WeakSet<object>()): string {
  if (typeof value === "string") return value;
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "bigint") return `${value}n`;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    try { return JSON.stringify(value, (_key, nested) => typeof nested === "bigint" ? `${nested}n` : nested, 2); }
    catch { return Object.prototype.toString.call(value); }
  }
  return String(value);
}

for (const level of ["log", "info", "warn", "error"] as const) {
  console[level] = (...values: unknown[]) => send("log", `[${level}] ${values.map((value) => printable(value)).join(" ")}`);
}

window.addEventListener("error", (event) => send("error", event.error ? printable(event.error) : event.message));
window.addEventListener("unhandledrejection", (event) => send("error", `Unhandled promise: ${printable(event.reason)}`));
window.addEventListener("message", (event: MessageEvent<{ source?: string; channel?: string; type?: string; code?: string; css?: string }>) => {
  const data = event.data;
  if (event.source !== parent || data?.source !== "pairboard-react-editor" || data.channel !== channel || data.type !== "run") return;
  document.head.querySelector("style[data-pairboard]")?.remove();
  document.body.innerHTML = '<div id="root"></div>';
  const style = document.createElement("style");
  style.dataset.pairboard = "true";
  style.textContent = data.css ?? "";
  document.head.append(style);
  const source = new Blob([`${data.code ?? ""}\n//# sourceURL=pairboard-react-project.js`], { type: "text/javascript" });
  const url = URL.createObjectURL(source);
  const script = document.createElement("script");
  script.src = url;
  script.onload = () => { URL.revokeObjectURL(url); send("rendered"); };
  script.onerror = () => { URL.revokeObjectURL(url); send("error", "Не удалось выполнить собранный проект"); };
  document.body.append(script);
});

send("ready");
