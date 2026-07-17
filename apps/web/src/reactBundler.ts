import * as esbuild from "esbuild-wasm";
import wasmUrl from "esbuild-wasm/esbuild.wasm?url";
import type { ReactProject } from "./reactProject";
import { normalizeProjectPath } from "./reactProject";

export type ReactBundle = { code: string; css: string };

let initializePromise: Promise<void> | null = null;

function initialize() {
  initializePromise ??= esbuild.initialize({ wasmURL: wasmUrl, worker: true });
  return initializePromise;
}

function dirname(path: string) {
  return path.slice(0, Math.max(1, path.lastIndexOf("/")));
}

function loaderFor(path: string): esbuild.Loader {
  if (path.endsWith(".module.css")) return "local-css";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".jsx")) return "jsx";
  return "js";
}

const runtimeModules: Record<string, string> = {
  react: "module.exports = globalThis.__PAIRBOARD_REACT__;",
  "react-dom": "module.exports = globalThis.__PAIRBOARD_REACT_DOM__;",
  "react-dom/client": "module.exports = globalThis.__PAIRBOARD_REACT_DOM_CLIENT__;",
  "react/jsx-runtime": "module.exports = globalThis.__PAIRBOARD_JSX_RUNTIME__;",
  "react/jsx-dev-runtime": "module.exports = globalThis.__PAIRBOARD_JSX_DEV_RUNTIME__;",
};

export async function bundleReactProject(project: ReactProject): Promise<ReactBundle> {
  await initialize();
  const files = new Map(project.files.map((file) => [normalizeProjectPath(file.path), file.content]));
  const extensions = [".tsx", ".ts", ".jsx", ".js", ".module.css", ".css"];
  const resolveFile = (path: string) => {
    const normalized = normalizeProjectPath(path);
    if (files.has(normalized)) return normalized;
    for (const suffix of extensions) if (files.has(`${normalized}${suffix}`)) return `${normalized}${suffix}`;
    for (const suffix of extensions) if (files.has(`${normalized}/index${suffix}`)) return `${normalized}/index${suffix}`;
    return null;
  };

  const virtualFiles: esbuild.Plugin = {
    name: "pairboard-virtual-files",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (runtimeModules[args.path]) return { path: args.path, namespace: "pairboard-runtime" };
        if (args.kind !== "entry-point" && !args.path.startsWith(".") && !args.path.startsWith("/")) {
          return { errors: [{ text: `Пакет «${args.path}» недоступен. В React-задачах нельзя устанавливать зависимости.` }] };
        }
        const requested = args.kind === "entry-point" || args.path.startsWith("/")
          ? args.path
          : `${args.resolveDir}/${args.path}`;
        const path = resolveFile(requested);
        return path
          ? { path, namespace: "pairboard-file" }
          : { errors: [{ text: `Не найден файл «${args.path}» из ${args.importer || project.entry}` }] };
      });
      build.onLoad({ filter: /.*/, namespace: "pairboard-runtime" }, (args) => ({ contents: runtimeModules[args.path], loader: "js" }));
      build.onLoad({ filter: /.*/, namespace: "pairboard-file" }, (args) => ({
        contents: files.get(args.path)!,
        loader: loaderFor(args.path),
        resolveDir: dirname(args.path),
      }));
    },
  };

  const result = await esbuild.build({
    entryPoints: [project.entry],
    bundle: true,
    write: false,
    outdir: "/pairboard-build",
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    sourcemap: "inline",
    logLevel: "silent",
    plugins: [virtualFiles],
  });
  const code = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  if (!code) throw new Error("Сборщик не создал JavaScript-файл");
  return { code, css: result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "" };
}

export function formatBuildError(error: unknown) {
  if (error && typeof error === "object" && "errors" in error && Array.isArray(error.errors)) {
    return error.errors.map((item: { text?: string; location?: { file?: string; line?: number; column?: number } }) => {
      const location = item.location;
      const prefix = location ? `${location.file ?? "файл"}:${location.line ?? 0}:${location.column ?? 0} — ` : "";
      return `${prefix}${item.text ?? "Ошибка сборки"}`;
    });
  }
  return [error instanceof Error ? error.message : "Неизвестная ошибка сборки"];
}
