import { DeleteOutlined, EditOutlined, FileAddOutlined, FileOutlined, FolderOpenOutlined, ReloadOutlined } from "@ant-design/icons";
import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { Button, Input, Modal, Tooltip, message } from "antd";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import { bundleReactProject, formatBuildError, type ReactBundle } from "../reactBundler";
import { isAllowedReactFile, normalizeProjectPath, parseReactProject, serializeReactProject, starterForPath, type ReactProject } from "../reactProject";
import type { Board } from "../types";
import { Pomodoro } from "./Pomodoro";

export type ReactBoardWorkspaceHandle = { run: () => void; stop: () => void };

type Props = {
  board: Board;
  workspaceId: string;
  content: string;
  onContentChange: (content: string) => void;
  onEditorMount: OnMount;
  activeFileRef: MutableRefObject<string | null>;
  output: string[];
  setOutput: Dispatch<SetStateAction<string[]>>;
  onRunningChange: (running: boolean) => void;
};

type FileDialog = { mode: "create" | "rename"; path: string } | null;
type PreviewMessage = { source?: string; channel?: string; type?: "ready" | "log" | "error" | "rendered"; value?: string };

const DEFAULT_OUTPUT_WIDTH = 420;
const MIN_OUTPUT_WIDTH = 300;
const MAX_OUTPUT_WIDTH = 720;
const OUTPUT_WIDTH_KEY = "pairboard_react_output_width";

function storedOutputWidth() {
  if (typeof window === "undefined") return DEFAULT_OUTPUT_WIDTH;
  const value = Number(localStorage.getItem(OUTPUT_WIDTH_KEY));
  return Number.isFinite(value) ? Math.min(MAX_OUTPUT_WIDTH, Math.max(MIN_OUTPUT_WIDTH, value)) : DEFAULT_OUTPUT_WIDTH;
}

const REACT_EDITOR_TYPES = `
declare module "*.module.css" { const classes: Record<string, string>; export default classes; }
declare module "react" {
  export const StrictMode: any;
  export function useState<T>(initial: T): [T, (next: T | ((value: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), dependencies?: unknown[]): void;
  export function useMemo<T>(factory: () => T, dependencies: unknown[]): T;
  export function useRef<T>(value: T): { current: T };
  const React: any; export default React;
}
declare module "react-dom/client" { export function createRoot(node: Element | DocumentFragment): { render(value: any): void; unmount(): void }; }
declare module "react/jsx-runtime" { export const Fragment: any; export function jsx(...args: any[]): any; export function jsxs(...args: any[]): any; }
declare namespace JSX { interface IntrinsicElements { [element: string]: any } }
`;

function languageFor(path: string) {
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  return "javascript";
}

export const ReactBoardWorkspace = forwardRef<ReactBoardWorkspaceHandle, Props>(function ReactBoardWorkspace({
  board,
  workspaceId,
  content,
  onContentChange,
  onEditorMount,
  activeFileRef,
  output,
  setOutput,
  onRunningChange,
}, ref) {
  const parsed = useMemo(() => {
    try { return { project: parseReactProject(content), error: "" }; }
    catch (error) { return { project: null, error: error instanceof Error ? error.message : "React-проект повреждён" }; }
  }, [content]);
  const project = parsed.project;
  const [activePath, setActivePath] = useState<string>(project?.entry ?? "");
  const [fileDialog, setFileDialog] = useState<FileDialog>(null);
  const [filePathDraft, setFilePathDraft] = useState("");
  const [deletePath, setDeletePath] = useState<string | null>(null);
  const [previewRun, setPreviewRun] = useState(0);
  const [building, setBuilding] = useState(false);
  const [outputWidth, setOutputWidth] = useState(storedOutputWidth);
  const [resizingOutput, setResizingOutput] = useState(false);
  const layoutRef = useRef<HTMLElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const pendingBundle = useRef<ReactBundle | null>(null);
  const resizeState = useRef<{ startX: number; startWidth: number; width: number } | null>(null);
  const channel = useRef(globalThis.crypto?.randomUUID?.() ?? `preview-${Date.now()}-${Math.random()}`).current;

  const activeFile = project?.files.find((file) => file.path === activePath) ?? project?.files.find((file) => file.path === project.entry) ?? null;
  activeFileRef.current = activeFile?.path ?? null;

  useEffect(() => {
    if (project && !project.files.some((file) => file.path === activePath)) setActivePath(project.entry);
  }, [activePath, project]);

  const clampOutputWidth = useCallback((value: number) => {
    const layoutWidth = layoutRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const filePaneWidth = layoutRef.current?.querySelector<HTMLElement>(".react-file-pane")?.offsetWidth ?? 190;
    const available = Math.max(MIN_OUTPUT_WIDTH, layoutWidth - filePaneWidth - 280);
    return Math.min(MAX_OUTPUT_WIDTH, available, Math.max(MIN_OUTPUT_WIDTH, value));
  }, []);

  const setAndStoreOutputWidth = useCallback((value: number) => {
    const next = clampOutputWidth(value);
    if (resizeState.current) resizeState.current.width = next;
    setOutputWidth(next);
    localStorage.setItem(OUTPUT_WIDTH_KEY, String(next));
  }, [clampOutputWidth]);

  useEffect(() => {
    const clampOnResize = () => setOutputWidth((current) => {
      const next = clampOutputWidth(current);
      if (next !== current) localStorage.setItem(OUTPUT_WIDTH_KEY, String(next));
      return next;
    });
    window.addEventListener("resize", clampOnResize);
    return () => {
      window.removeEventListener("resize", clampOnResize);
      document.body.classList.remove("is-resizing-session");
    };
  }, [clampOutputWidth]);

  const startOutputResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeState.current = { startX: event.clientX, startWidth: outputWidth, width: outputWidth };
    setResizingOutput(true);
    document.body.classList.add("is-resizing-session");
  };
  const moveOutputResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeState.current) return;
    setAndStoreOutputWidth(resizeState.current.startWidth + resizeState.current.startX - event.clientX);
  };
  const stopOutputResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeState.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    localStorage.setItem(OUTPUT_WIDTH_KEY, String(resizeState.current.width));
    resizeState.current = null;
    setResizingOutput(false);
    document.body.classList.remove("is-resizing-session");
  };
  const resizeOutputWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setAndStoreOutputWidth(outputWidth + (event.key === "ArrowLeft" ? 24 : -24));
  };

  const commitProject = useCallback((next: ReactProject) => onContentChange(serializeReactProject(next)), [onContentChange]);

  const run = useCallback(() => {
    if (!project || building) return;
    setBuilding(true);
    onRunningChange(true);
    setOutput(["▶ Сборка React 19 проекта..."]);
    void bundleReactProject(project)
      .then((bundle) => {
        pendingBundle.current = bundle;
        setOutput(["✓ Сборка завершена", "↗ Запускаем UI в изолированном preview..."]);
        setPreviewRun((value) => value + 1);
      })
      .catch((error: unknown) => {
        setOutput(formatBuildError(error).map((line) => `Ошибка сборки: ${line}`));
        onRunningChange(false);
      })
      .finally(() => setBuilding(false));
  }, [building, onRunningChange, project, setOutput]);

  const stop = useCallback(() => {
    pendingBundle.current = null;
    setPreviewRun((value) => value + 1);
    setOutput((current) => [...current, "■ Preview перезапущен пользователем"]);
    onRunningChange(false);
  }, [onRunningChange, setOutput]);

  useImperativeHandle(ref, () => ({ run, stop }), [run, stop]);

  const deliverBundle = useCallback(() => {
    if (!pendingBundle.current) return;
    iframeRef.current?.contentWindow?.postMessage({ source: "pairboard-react-editor", channel, type: "run", ...pendingBundle.current }, "*");
    pendingBundle.current = null;
  }, [channel]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<PreviewMessage>) => {
      const data = event.data;
      if (event.source !== iframeRef.current?.contentWindow || data?.source !== "pairboard-react-preview" || data.channel !== channel) return;
      if (data.type === "ready") deliverBundle();
      if (data.type === "log") setOutput((current) => [...current, data.value ?? ""]);
      if (data.type === "error") { setOutput((current) => [...current, `Ошибка UI: ${data.value ?? "Неизвестная ошибка"}`]); onRunningChange(false); }
      if (data.type === "rendered") { setOutput((current) => [...current, "✓ UI отрисован"]); onRunningChange(false); }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [channel, deliverBundle, onRunningChange, setOutput]);

  const beforeMount: BeforeMount = (monaco) => {
    monaco.editor.defineTheme("pairboard-dark", { base: "vs-dark", inherit: true, rules: [], colors: { "editor.background": "#0b0e12", "editor.lineHighlightBackground": "#11161c", "editorCursor.foreground": "#9bff65", "editor.selectionBackground": "#2d4a3f88", "editorLineNumber.foreground": "#3d4652", "editorLineNumber.activeForeground": "#8d99a8" } });
    monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
    monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({ allowNonTsExtensions: true, allowJs: true, jsx: monaco.languages.typescript.JsxEmit.ReactJSX, target: monaco.languages.typescript.ScriptTarget.ES2022, moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs });
    monaco.languages.typescript.typescriptDefaults.addExtraLib(REACT_EDITOR_TYPES, "file:///pairboard-react.d.ts");
  };

  const openCreate = () => { setFilePathDraft("src/"); setFileDialog({ mode: "create", path: "" }); };
  const openRename = (path: string) => { setFilePathDraft(path.slice(1)); setFileDialog({ mode: "rename", path }); };
  const applyFileDialog = () => {
    if (!project || !fileDialog) return;
    const path = normalizeProjectPath(filePathDraft);
    if (path === "/" || path.length > 180 || !isAllowedReactFile(path, board.language)) {
      message.error(board.language === "TYPESCRIPT" ? "Допустимы .ts, .tsx, .css и .module.css" : "Допустимы .js, .jsx, .css и .module.css");
      return;
    }
    if (project.files.some((file) => file.path === path && file.path !== fileDialog.path)) { message.error("Файл с таким именем уже существует"); return; }
    if (fileDialog.mode === "create") {
      commitProject({ ...project, files: [...project.files, { path, content: starterForPath(path) }] });
    } else {
      commitProject({ ...project, entry: project.entry === fileDialog.path ? path : project.entry, files: project.files.map((file) => file.path === fileDialog.path ? { ...file, path } : file) });
    }
    setActivePath(path);
    setFileDialog(null);
  };
  const deleteFile = () => {
    if (!project || !deletePath) return;
    if (deletePath === project.entry) { message.error("Главный файл нельзя удалить — сначала переименуйте его"); setDeletePath(null); return; }
    commitProject({ ...project, files: project.files.filter((file) => file.path !== deletePath) });
    if (activePath === deletePath) setActivePath(project.entry);
    setDeletePath(null);
  };

  if (!project || !activeFile) return <div className="react-project-error"><b>React-проект не удалось открыть</b><span>{parsed.error}</span></div>;
  const files = [...project.files].sort((a, b) => a.path.localeCompare(b.path));

  return <>
    <main ref={layoutRef} className="react-editor-layout" style={{ "--react-output-width": `${outputWidth}px` } as CSSProperties}>
      <aside className="react-file-pane">
        <header><span><FolderOpenOutlined /> ФАЙЛЫ</span><Tooltip title="Создать файл"><button type="button" onClick={openCreate} aria-label="Создать файл"><FileAddOutlined /></button></Tooltip></header>
        <nav>{files.map((file) => <div className={`react-file-row ${file.path === activeFile.path ? "is-active" : ""}`} key={file.path}>
          <button className="react-file-row__open" type="button" onClick={() => setActivePath(file.path)} title={file.path}><FileOutlined /><span>{file.path.slice(1)}</span>{file.path === project.entry && <small>ENTRY</small>}</button>
          <span className="react-file-row__actions"><button type="button" onClick={() => openRename(file.path)} aria-label={`Переименовать ${file.path}`}><EditOutlined /></button><button type="button" disabled={file.path === project.entry} onClick={() => setDeletePath(file.path)} aria-label={`Удалить ${file.path}`}><DeleteOutlined /></button></span>
        </div>)}</nav>
        <footer><b>React 19.1.0</b><span>{board.language === "TYPESCRIPT" ? "TS / TSX" : "JS / JSX"} · CSS Modules</span><small>Пакеты отключены</small></footer>
      </aside>
      <section className="react-code-pane">
        <div className="editor-tab"><span>{activeFile.path}</span><small>● LIVE</small></div>
        <Editor
          height="100%"
          path={`file://${activeFile.path}`}
          language={languageFor(activeFile.path)}
          value={activeFile.content}
          theme="pairboard-dark"
          beforeMount={beforeMount}
          onMount={onEditorMount}
          onChange={(value = "") => commitProject({ ...project, files: project.files.map((file) => file.path === activeFile.path ? { ...file, content: value } : file) })}
          options={{ automaticLayout: true, fontFamily: "'JetBrains Mono', monospace", fontSize: 14, lineHeight: 23, minimap: { enabled: false }, padding: { top: 16 }, smoothScrolling: true, cursorSmoothCaretAnimation: "on", formatOnPaste: true, tabSize: 2, wordWrap: "on" }}
        />
      </section>
      <aside className={`react-output-pane ${resizingOutput ? "session-pane--resizing" : ""}`}>
        <div
          className="session-resizer react-output-resizer"
          role="separator"
          aria-label="Изменить ширину панели preview и консоли"
          aria-orientation="vertical"
          aria-valuemin={MIN_OUTPUT_WIDTH}
          aria-valuemax={MAX_OUTPUT_WIDTH}
          aria-valuenow={Math.round(outputWidth)}
          tabIndex={0}
          onPointerDown={startOutputResize}
          onPointerMove={moveOutputResize}
          onPointerUp={stopOutputResize}
          onPointerCancel={stopOutputResize}
          onDoubleClick={() => setAndStoreOutputWidth(DEFAULT_OUTPUT_WIDTH)}
          onKeyDown={resizeOutputWithKeyboard}
        ><span /></div>
        <Pomodoro workspaceId={workspaceId} compact />
        <section className="react-preview">
          <header><span>UI PREVIEW</span><button type="button" onClick={run} disabled={building}><ReloadOutlined /> обновить</button></header>
          <iframe ref={iframeRef} key={previewRun} src={`/react-preview.html?channel=${encodeURIComponent(channel)}&run=${previewRun}`} sandbox="allow-scripts" title="Предпросмотр React-интерфейса" onLoad={deliverBundle} />
        </section>
        <div className="console react-console"><header><span>КОНСОЛЬ</span><button onClick={() => setOutput([])}>очистить</button></header><pre aria-live="polite">{output.map((line, index) => <span key={index}>{line}</span>)}</pre></div>
      </aside>
    </main>
    <Modal title={fileDialog?.mode === "create" ? "Новый файл" : "Переименовать файл"} open={Boolean(fileDialog)} okText={fileDialog?.mode === "create" ? "Создать" : "Переименовать"} cancelText="Отмена" onCancel={() => setFileDialog(null)} onOk={applyFileDialog}>
      <Input autoFocus value={filePathDraft} onChange={(event) => setFilePathDraft(event.target.value)} onPressEnter={applyFileDialog} placeholder={board.language === "TYPESCRIPT" ? "src/Component.tsx" : "src/Component.jsx"} />
      <p className="react-file-dialog__hint">Путь может содержать папки. Поддерживаются исходники выбранного языка, обычный CSS и .module.css.</p>
    </Modal>
    <Modal title="Удалить файл?" open={Boolean(deletePath)} okText="Удалить" cancelText="Отмена" okButtonProps={{ danger: true }} onCancel={() => setDeletePath(null)} onOk={deleteFile}><p>Файл <code>{deletePath}</code> будет удалён из проекта.</p></Modal>
  </>;
});
