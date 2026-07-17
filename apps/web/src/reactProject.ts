import type { Board } from "./types";

export const REACT_RUNTIME = "react@19.1.0";
export const REACT_PROJECT_FORMAT = "pairboard-react-project";

export type ReactProjectFile = { path: string; content: string };
export type ReactProject = {
  format: typeof REACT_PROJECT_FORMAT;
  version: 1;
  runtime: typeof REACT_RUNTIME;
  entry: string;
  files: ReactProjectFile[];
};

export function normalizeProjectPath(value: string) {
  const parts: string[] = [];
  for (const part of value.trim().replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export function isAllowedReactFile(path: string, language: Board["language"]) {
  if (path.endsWith(".css")) return true;
  return language === "TYPESCRIPT"
    ? path.endsWith(".ts") || path.endsWith(".tsx")
    : path.endsWith(".js") || path.endsWith(".jsx");
}

export function parseReactProject(content: string): ReactProject {
  const value = JSON.parse(content) as Partial<ReactProject>;
  if (value.format !== REACT_PROJECT_FORMAT || value.version !== 1 || !Array.isArray(value.files) || typeof value.entry !== "string") {
    throw new Error("Формат React-проекта не поддерживается");
  }
  const files = value.files.map((file) => {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") throw new Error("React-проект содержит повреждённый файл");
    return { path: normalizeProjectPath(file.path), content: file.content };
  });
  if (!files.some((file) => file.path === normalizeProjectPath(value.entry!))) throw new Error("Главный файл React-проекта не найден");
  return { format: REACT_PROJECT_FORMAT, version: 1, runtime: REACT_RUNTIME, entry: normalizeProjectPath(value.entry), files };
}

export function serializeReactProject(project: ReactProject) {
  return JSON.stringify(project);
}

export function starterForPath(path: string) {
  if (path.endsWith(".css")) return "";
  if (path.endsWith(".tsx") || path.endsWith(".jsx")) {
    const name = path.split("/").pop()?.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_$]/g, "") || "Component";
    const component = /^[A-Z]/.test(name) ? name : `Component${name.slice(0, 1).toUpperCase()}${name.slice(1)}`;
    return `export default function ${component}() {\n  return <div>${component}</div>;\n}\n`;
  }
  return "export {};\n";
}
