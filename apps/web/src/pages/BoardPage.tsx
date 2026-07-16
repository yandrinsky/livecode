import { ArrowLeftOutlined, CheckCircleFilled, CloseOutlined, CodeOutlined, PlayCircleFilled, SaveOutlined, TeamOutlined } from "@ant-design/icons";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Avatar, Button, Drawer, Skeleton, Tag, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useParams } from "react-router-dom";
import ts from "typescript";
import { api } from "../api";
import { Pomodoro } from "../components/Pomodoro";
import { liveSocket } from "../socket";
import type { Board, User } from "../types";

type EditorInstance = Parameters<OnMount>[0];
type MonacoInstance = Parameters<OnMount>[1];
type DecorationCollection = ReturnType<EditorInstance["createDecorationsCollection"]>;
type BoardSelection = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
type RemoteSelection = { boardId: string; clientId: string; user: User; selection: BoardSelection };

const DEFAULT_SESSION_WIDTH = 305;
const MIN_SESSION_WIDTH = 260;
const MAX_SESSION_WIDTH = 720;
const SESSION_WIDTH_KEY = "pairboard_session_width";

function storedSessionWidth() {
  if (typeof window === "undefined") return DEFAULT_SESSION_WIDTH;
  const value = Number(localStorage.getItem(SESSION_WIDTH_KEY));
  return Number.isFinite(value) ? Math.min(MAX_SESSION_WIDTH, Math.max(MIN_SESSION_WIDTH, value)) : DEFAULT_SESSION_WIDTH;
}

function colorIndex(id: string) {
  return [...id].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) | 0, 0) >>> 0;
}

export function BoardPage() {
  const { workspaceId = "", boardId = "" } = useParams();
  const socket = useMemo(liveSocket, []);
  const [board, setBoard] = useState<Board | null>(null);
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(true);
  const [presence, setPresence] = useState<User[]>([]);
  const [output, setOutput] = useState<string[]>(["Готово к запуску. Добавьте console.log, чтобы увидеть результат."]);
  const [running, setRunning] = useState(false);
  const [mobileConsoleOpen, setMobileConsoleOpen] = useState(false);
  const [sessionWidth, setSessionWidth] = useState(storedSessionWidth);
  const [resizingSession, setResizingSession] = useState(false);
  const remote = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const selectionTimer = useRef<number | undefined>(undefined);
  const editorRef = useRef<EditorInstance | null>(null);
  const monacoRef = useRef<MonacoInstance | null>(null);
  const selectionDisposable = useRef<{ dispose: () => void } | null>(null);
  const editorPointerCleanup = useRef<(() => void) | null>(null);
  const remoteDecorations = useRef(new Map<string, DecorationCollection>());
  const resizeState = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

  useEffect(() => {
    api<{ board: Board }>(`/boards/${boardId}`).then(({ board: value }) => { setBoard(value); setCode(value.content); });
  }, [boardId]);

  useEffect(() => {
    const reportActivity = () => {
      if (document.visibilityState === "visible") void api(`/boards/${boardId}/activity`, { method: "POST" }).catch(() => undefined);
    };
    reportActivity();
    const interval = window.setInterval(reportActivity, 30_000);
    document.addEventListener("visibilitychange", reportActivity);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", reportActivity);
    };
  }, [boardId]);

  useEffect(() => {
    const onChange = (data: { boardId: string; content: string; version: number }) => {
      if (data.boardId !== boardId) return;
      remote.current = true; setCode(data.content); setSaved(true); setBoard((b) => b ? { ...b, version: data.version } : b);
    };
    const onSaved = (data: { version: number }) => { setSaved(true); setBoard((b) => b ? { ...b, version: data.version } : b); };
    const onSelection = (data: RemoteSelection) => {
      if (data.boardId !== boardId || data.clientId === socket.id) return;
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      const model = editor?.getModel();
      if (!editor || !monaco || !model) return;
      const startLine = Math.min(model.getLineCount(), Math.max(1, data.selection.startLineNumber));
      const endLine = Math.min(model.getLineCount(), Math.max(1, data.selection.endLineNumber));
      const startColumn = Math.min(model.getLineMaxColumn(startLine), Math.max(1, data.selection.startColumn));
      const endColumn = Math.min(model.getLineMaxColumn(endLine), Math.max(1, data.selection.endColumn));
      const range = new monaco.Range(startLine, startColumn, endLine, endColumn);
      const cursorRange = new monaco.Range(endLine, endColumn, endLine, endColumn);
      const palette = colorIndex(data.user.id) % 6;
      let collection = remoteDecorations.current.get(data.clientId);
      if (!collection) {
        collection = editor.createDecorationsCollection();
        remoteDecorations.current.set(data.clientId, collection);
      }
      const isCollapsed = range.isEmpty();
      collection.set([
        ...(!isCollapsed ? [{
          range,
          options: {
            inlineClassName: `remote-selection remote-selection--${palette}`,
            hoverMessage: { value: `**${data.user.displayName}** выделил этот фрагмент` },
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        }] : []),
        {
          range: cursorRange,
          options: {
            afterContentClassName: `remote-cursor remote-cursor--${palette}`,
            hoverMessage: { value: `**${data.user.displayName}**` },
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        },
      ]);
    };
    const clearSelection = (data: { boardId: string; clientId: string }) => {
      if (data.boardId !== boardId) return;
      remoteDecorations.current.get(data.clientId)?.clear();
      remoteDecorations.current.delete(data.clientId);
    };
    socket.emit("board:join", boardId);
    socket.on("board:change", onChange); socket.on("board:saved", onSaved); socket.on("board:selection", onSelection); socket.on("board:selection-clear", clearSelection); socket.on("presence:update", setPresence);
    return () => {
      socket.emit("board:leave", boardId);
      socket.off("board:change", onChange); socket.off("board:saved", onSaved); socket.off("board:selection", onSelection); socket.off("board:selection-clear", clearSelection); socket.off("presence:update", setPresence);
      selectionDisposable.current?.dispose(); selectionDisposable.current = null;
      window.clearTimeout(selectionTimer.current);
      for (const collection of remoteDecorations.current.values()) collection.clear();
      remoteDecorations.current.clear();
    };
  }, [socket, workspaceId, boardId]);

  useEffect(() => {
    const ignoreBrowserSave = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", ignoreBrowserSave, true);
    return () => window.removeEventListener("keydown", ignoreBrowserSave, true);
  }, []);

  useEffect(() => {
    let layoutFrame = 0;
    const refreshEditorLayout = () => {
      window.cancelAnimationFrame(layoutFrame);
      layoutFrame = window.requestAnimationFrame(() => editorRef.current?.layout());
    };
    const releaseStaleFocus = () => {
      const editorNode = editorRef.current?.getDomNode();
      const activeElement = document.activeElement;
      if (editorNode && activeElement instanceof HTMLElement && editorNode.contains(activeElement)) activeElement.blur();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") releaseStaleFocus();
      else refreshEditorLayout();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", releaseStaleFocus);
    window.addEventListener("pageshow", refreshEditorLayout);
    window.addEventListener("focus", refreshEditorLayout);
    return () => {
      window.cancelAnimationFrame(layoutFrame);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", releaseStaleFocus);
      window.removeEventListener("pageshow", refreshEditorLayout);
      window.removeEventListener("focus", refreshEditorLayout);
      editorPointerCleanup.current?.();
      editorPointerCleanup.current = null;
    };
  }, []);

  useEffect(() => {
    const clampOnResize = () => {
      const next = Math.min(sessionWidth, Math.max(MIN_SESSION_WIDTH, window.innerWidth - 420));
      if (next !== sessionWidth) { setSessionWidth(next); localStorage.setItem(SESSION_WIDTH_KEY, String(next)); }
    };
    window.addEventListener("resize", clampOnResize);
    return () => window.removeEventListener("resize", clampOnResize);
  }, [sessionWidth]);

  const updateCode = (value = "") => {
    setCode(value);
    if (remote.current) { remote.current = false; return; }
    setSaved(false); window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => socket.emit("board:change", { boardId, content: value }), 500);
  };

  const mountEditor: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    monaco.editor.setTheme("pairboard-dark");
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => undefined);
    editorPointerCleanup.current?.();
    const editorNode = editor.getDomNode();
    const focusFromTouch = () => {
      editor.layout();
      editor.focus();
    };
    editorNode?.addEventListener("pointerdown", focusFromTouch, true);
    editorPointerCleanup.current = () => editorNode?.removeEventListener("pointerdown", focusFromTouch, true);
    selectionDisposable.current?.dispose();
    selectionDisposable.current = editor.onDidChangeCursorSelection(({ selection }) => {
      window.clearTimeout(selectionTimer.current);
      selectionTimer.current = window.setTimeout(() => {
        socket.emit("board:selection", {
          boardId,
          selection: {
            startLineNumber: selection.startLineNumber,
            startColumn: selection.startColumn,
            endLineNumber: selection.endLineNumber,
            endColumn: selection.endColumn,
          },
        });
      }, 50);
    });
  };

  const clampWidth = (value: number) => Math.min(MAX_SESSION_WIDTH, Math.max(MIN_SESSION_WIDTH, Math.min(value, window.innerWidth - 420)));
  const setAndStoreSessionWidth = (value: number) => {
    const next = clampWidth(value);
    resizeState.current && (resizeState.current.width = next);
    setSessionWidth(next);
    localStorage.setItem(SESSION_WIDTH_KEY, String(next));
  };
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeState.current = { startX: event.clientX, startWidth: sessionWidth, width: sessionWidth };
    setResizingSession(true);
    document.body.classList.add("is-resizing-session");
  };
  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeState.current) return;
    setAndStoreSessionWidth(resizeState.current.startWidth + resizeState.current.startX - event.clientX);
  };
  const stopResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeState.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    localStorage.setItem(SESSION_WIDTH_KEY, String(resizeState.current.width));
    resizeState.current = null;
    setResizingSession(false);
    document.body.classList.remove("is-resizing-session");
  };
  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setAndStoreSessionWidth(sessionWidth + (event.key === "ArrowLeft" ? 24 : -24));
  };

  const run = useCallback(() => {
    if (running) return;
    if (window.matchMedia("(max-width: 760px)").matches) setMobileConsoleOpen(true);
    setRunning(true); setOutput(["▶ Запуск..."]);
    const js = ts.transpile(code, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, allowJs: true });
    const workerSource = `const exports = {}; const module = { exports }; const logs = []; console.log = (...args) => postMessage({type:'log', value:args.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')}); try { ${js}\n postMessage({type:'done'}); } catch (error) { postMessage({type:'error', value:error.stack || error.message}); }`;
    const blob = new Blob([workerSource], { type: "text/javascript" });
    const worker = new Worker(URL.createObjectURL(blob));
    const result: string[] = [];
    const timeout = window.setTimeout(() => { worker.terminate(); setOutput([...result, "■ Выполнение остановлено: лимит 2 секунды"]); setRunning(false); }, 2000);
    worker.onmessage = (event) => {
      if (event.data.type === "log") { result.push(event.data.value); setOutput([...result]); }
      if (event.data.type === "error") { window.clearTimeout(timeout); result.push(`Ошибка: ${event.data.value}`); setOutput([...result]); setRunning(false); worker.terminate(); }
      if (event.data.type === "done") { window.clearTimeout(timeout); setOutput(result.length ? result : ["✓ Выполнено без вывода"]); setRunning(false); worker.terminate(); }
    };
  }, [code, running]);

  useEffect(() => {
    const runWithKeyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        run();
      }
    };
    window.addEventListener("keydown", runWithKeyboard, true);
    return () => window.removeEventListener("keydown", runWithKeyboard, true);
  }, [run]);

  if (!board) return <div className="board-loading"><Skeleton active paragraph={{ rows: 12 }} /></div>;
  return <div className="board-room">
    <header className="board-toolbar">
      <Link to={`/workspace/${workspaceId}`} className="board-toolbar__back"><ArrowLeftOutlined /></Link>
      <div className="board-toolbar__title"><span>{board.workspaceId ? "ЗАДАЧА" : "ДОСКА"} / {board.groupName?.toUpperCase() ?? "БЕЗ ГРУППЫ"}</span><h1>{board.title}</h1></div>
      <Tag className="language-tag">{board.language === "TYPESCRIPT" ? "TypeScript" : "JavaScript"}</Tag>
      <div className="save-state">{saved ? <><CheckCircleFilled /> сохранено · v{board.version}</> : <><SaveOutlined /> сохраняем...</>}</div>
      <div className="presence"><Avatar.Group max={{ count: 3 }}>{presence.map((person) => <Tooltip title={person.displayName} key={person.id}><Avatar>{person.displayName.slice(0, 1)}</Avatar></Tooltip>)}</Avatar.Group><span><i /> {presence.length || 1} в комнате</span></div>
      <Button className="mobile-console-button" icon={<CodeOutlined />} aria-label="Открыть консоль вывода" onClick={() => setMobileConsoleOpen(true)}><span>Вывод</span></Button>
      <Button className="run-button" type="primary" icon={<PlayCircleFilled />} loading={running} onClick={run} title="Ctrl + Enter">Запустить</Button>
    </header>
    <section className="board-context"><CodeOutlined /><div><span>УСЛОВИЕ</span><p>{board.description || "Условие не добавлено. Обсудите задачу прямо во время сессии."}</p></div><button><CloseOutlined /></button></section>
    <main className="editor-layout" style={{ "--session-pane-width": `${sessionWidth}px` } as CSSProperties}>
      <div className="editor-pane">
        <div className="editor-tab"><span>{board.title.toLowerCase().replaceAll(" ", "-")}.{board.language === "TYPESCRIPT" ? "ts" : "js"}</span><small><TeamOutlined /> LIVE</small></div>
        <Editor
          height="100%"
          language={board.language === "TYPESCRIPT" ? "typescript" : "javascript"}
          value={code}
          theme="vs-dark"
          onChange={updateCode}
          beforeMount={(monaco) => monaco.editor.defineTheme("pairboard-dark", { base: "vs-dark", inherit: true, rules: [], colors: { "editor.background": "#0b0e12", "editor.lineHighlightBackground": "#11161c", "editorCursor.foreground": "#9bff65", "editor.selectionBackground": "#2d4a3f88", "editorLineNumber.foreground": "#3d4652", "editorLineNumber.activeForeground": "#8d99a8" } })}
          onMount={mountEditor}
          options={{ automaticLayout: true, fontFamily: "'JetBrains Mono', monospace", fontSize: 15, lineHeight: 24, minimap: { enabled: false }, padding: { top: 18 }, smoothScrolling: true, cursorSmoothCaretAnimation: "on", formatOnPaste: true, tabSize: 2, wordWrap: "on" }}
        />
      </div>
      <aside className={`session-pane ${resizingSession ? "session-pane--resizing" : ""}`}>
        <div
          className="session-resizer"
          role="separator"
          aria-label="Изменить ширину консоли"
          aria-orientation="vertical"
          aria-valuemin={MIN_SESSION_WIDTH}
          aria-valuemax={MAX_SESSION_WIDTH}
          aria-valuenow={Math.round(sessionWidth)}
          tabIndex={0}
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
          onDoubleClick={() => setAndStoreSessionWidth(DEFAULT_SESSION_WIDTH)}
          onKeyDown={resizeWithKeyboard}
        ><span /></div>
        <Pomodoro workspaceId={workspaceId} compact />
        <div className="console"><header><span>КОНСОЛЬ</span><button onClick={() => setOutput([])}>очистить</button></header><pre aria-live="polite">{output.map((line, i) => <span key={i}>{line}</span>)}</pre></div>
        <div className="session-tip"><span>ПОДСКАЗКА НАСТАВНИКУ</span><p>Дайте ученику проговорить идею до первой строки кода.</p></div>
      </aside>
    </main>
    <Drawer
      rootClassName="mobile-console-drawer"
      title={<span className="mobile-console-title">КОНСОЛЬ <i>OUTPUT</i></span>}
      extra={<Button type="text" size="small" onClick={() => setOutput([])}>очистить</Button>}
      placement="bottom"
      height="min(58dvh, 520px)"
      open={mobileConsoleOpen}
      onClose={() => setMobileConsoleOpen(false)}
    >
      <div className="mobile-console-output"><pre aria-live="polite">{output.map((line, i) => <span key={i}>{line}</span>)}</pre></div>
    </Drawer>
  </div>;
}
