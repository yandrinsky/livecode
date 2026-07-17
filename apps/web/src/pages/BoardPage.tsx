import { AppstoreOutlined, ArrowLeftOutlined, CheckCircleFilled, CodeOutlined, DownOutlined, HomeOutlined, MenuFoldOutlined, MenuUnfoldOutlined, PlayCircleFilled, ReloadOutlined, SaveOutlined, SearchOutlined, StopOutlined, TeamOutlined, UpOutlined, WarningOutlined } from "@ant-design/icons";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Avatar, Button, Drawer, Input, Skeleton, Spin, Tag, Tooltip } from "antd";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useParams } from "react-router-dom";
import ts from "typescript";
import { ApiError, api } from "../api";
import { createCodeWorkerSource } from "../codeRunner";
import { Pomodoro } from "../components/Pomodoro";
import { ReactBoardWorkspace, type ReactBoardWorkspaceHandle } from "../components/ReactBoardWorkspace";
import { useLiveSocket } from "../socket";
import type { Board, BoardSearchResult, User, Workspace } from "../types";

type EditorInstance = Parameters<OnMount>[0];
type MonacoInstance = Parameters<OnMount>[1];
type DecorationCollection = ReturnType<EditorInstance["createDecorationsCollection"]>;
type BoardSelection = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
type RemoteSelection = { boardId: string; clientId: string; user: User; filePath?: string; selection: BoardSelection };
type BoardLoadError = { message: string; status?: number };

const DEFAULT_SESSION_WIDTH = 305;
const MIN_SESSION_WIDTH = 260;
const MAX_SESSION_WIDTH = 720;
const SESSION_WIDTH_KEY = "pairboard_session_width";
const TASK_SIDEBAR_KEY = "pairboard_task_sidebar_open";

function storedSessionWidth() {
  if (typeof window === "undefined") return DEFAULT_SESSION_WIDTH;
  const value = Number(localStorage.getItem(SESSION_WIDTH_KEY));
  return Number.isFinite(value) ? Math.min(MAX_SESSION_WIDTH, Math.max(MIN_SESSION_WIDTH, value)) : DEFAULT_SESSION_WIDTH;
}

function storedTaskSidebarOpen() {
  if (typeof window === "undefined") return true;
  if (window.innerWidth <= 760) return false;
  return localStorage.getItem(TASK_SIDEBAR_KEY) !== "false";
}

function colorIndex(id: string) {
  return [...id].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) | 0, 0) >>> 0;
}

function searchMatchLabel(result: BoardSearchResult) {
  if (result.matchedField === "content") return result.lineNumber ? `КОД · СТРОКА ${result.lineNumber}` : "КОД";
  if (result.matchedField === "description") return "УСЛОВИЕ";
  if (result.matchedField === "groupName") return "ГРУППА";
  return "НАЗВАНИЕ";
}

export function BoardPage() {
  const { workspaceId = "", boardId = "" } = useParams();
  const { socket, status: realtimeStatus, error: realtimeError, retry: retryRealtime } = useLiveSocket();
  const [board, setBoard] = useState<Board | null>(null);
  const [workspaceBoards, setWorkspaceBoards] = useState<Board[]>([]);
  const [loadError, setLoadError] = useState<BoardLoadError | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(true);
  const [presence, setPresence] = useState<User[]>([]);
  const [output, setOutput] = useState<string[]>(["Готово к запуску. Добавьте console.log, чтобы увидеть результат."]);
  const [running, setRunning] = useState(false);
  const [mobileConsoleOpen, setMobileConsoleOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(true);
  const [taskSidebarOpen, setTaskSidebarOpen] = useState(storedTaskSidebarOpen);
  const [taskSearchOpen, setTaskSearchOpen] = useState(false);
  const [taskSearchQuery, setTaskSearchQuery] = useState("");
  const [taskSearchResults, setTaskSearchResults] = useState<BoardSearchResult[]>([]);
  const [taskSearchLoading, setTaskSearchLoading] = useState(false);
  const [taskSearchError, setTaskSearchError] = useState<string | null>(null);
  const [taskSearchAttempt, setTaskSearchAttempt] = useState(0);
  const [sessionWidth, setSessionWidth] = useState(storedSessionWidth);
  const [resizingSession, setResizingSession] = useState(false);
  const remote = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const selectionTimer = useRef<number | undefined>(undefined);
  const editorRef = useRef<EditorInstance | null>(null);
  const monacoRef = useRef<MonacoInstance | null>(null);
  const selectionDisposable = useRef<{ dispose: () => void } | null>(null);
  const editorPointerCleanup = useRef<(() => void) | null>(null);
  const activeWorker = useRef<{ worker: Worker; url: string } | null>(null);
  const reactWorkspaceRef = useRef<ReactBoardWorkspaceHandle | null>(null);
  const activeFileRef = useRef<string | null>(null);
  const remoteDecorations = useRef(new Map<string, DecorationCollection>());
  const resizeState = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

  useEffect(() => {
    let active = true;
    setBoard(null);
    setLoadError(null);
    setDescriptionOpen(true);
    api<{ board: Board }>(`/boards/${boardId}`)
      .then(({ board: value }) => {
        if (!active) return;
        setBoard(value);
        setCode(value.content);
        void api<{ workspace: Workspace }>(`/workspaces/${workspaceId}`)
          .then(({ workspace }) => {
            if (!active) return;
            setWorkspaceBoards(workspace.boards ?? [value]);
          })
          .catch(() => { if (active) setWorkspaceBoards([value]); });
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setLoadError({
          message: reason instanceof Error ? reason.message : "Не удалось загрузить доску",
          status: reason instanceof ApiError ? reason.status : undefined,
        });
      });
    return () => { active = false; };
  }, [workspaceId, boardId, loadAttempt]);

  useEffect(() => { setWorkspaceBoards([]); }, [workspaceId]);

  useEffect(() => {
    const query = taskSearchQuery.trim();
    if (!taskSearchOpen || query.length < 2) {
      setTaskSearchLoading(false);
      setTaskSearchResults([]);
      setTaskSearchError(null);
      return;
    }
    const controller = new AbortController();
    setTaskSearchLoading(true);
    setTaskSearchResults([]);
    setTaskSearchError(null);
    const debounce = window.setTimeout(() => {
      void api<{ results: BoardSearchResult[] }>(`/workspaces/${workspaceId}/boards/search?q=${encodeURIComponent(query)}&limit=20`, { signal: controller.signal })
        .then(({ results }) => {
          if (!controller.signal.aborted) setTaskSearchResults(results);
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) setTaskSearchError(reason instanceof Error ? reason.message : "Не удалось выполнить поиск");
        })
        .finally(() => {
          if (!controller.signal.aborted) setTaskSearchLoading(false);
        });
    }, 280);
    return () => {
      window.clearTimeout(debounce);
      controller.abort();
    };
  }, [taskSearchOpen, taskSearchQuery, taskSearchAttempt, workspaceId]);

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
    if (board?.id !== boardId) return;
    const onChange = (data: { boardId: string; content: string; version: number }) => {
      if (data.boardId !== boardId) return;
      remote.current = true; setCode(data.content); setSaved(true); setBoard((b) => b ? { ...b, version: data.version } : b);
    };
    const onSaved = (data: { version: number }) => { setSaved(true); setBoard((b) => b ? { ...b, version: data.version } : b); };
    const onSelection = (data: RemoteSelection) => {
      if (data.boardId !== boardId || data.clientId === socket.id) return;
      if ((data.filePath ?? null) !== activeFileRef.current) return;
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
    const joinBoard = () => socket.emit("board:join", boardId);
    joinBoard();
    socket.on("connect", joinBoard);
    socket.on("board:change", onChange); socket.on("board:saved", onSaved); socket.on("board:selection", onSelection); socket.on("board:selection-clear", clearSelection); socket.on("presence:update", setPresence);
    return () => {
      socket.emit("board:leave", boardId);
      socket.off("connect", joinBoard);
      socket.off("board:change", onChange); socket.off("board:saved", onSaved); socket.off("board:selection", onSelection); socket.off("board:selection-clear", clearSelection); socket.off("presence:update", setPresence);
      selectionDisposable.current?.dispose(); selectionDisposable.current = null;
      window.clearTimeout(selectionTimer.current);
      for (const collection of remoteDecorations.current.values()) collection.clear();
      remoteDecorations.current.clear();
    };
  }, [socket, workspaceId, boardId, board?.id]);

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
          filePath: activeFileRef.current ?? undefined,
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

  const stopRun = useCallback(() => {
    if (board?.kind === "REACT") {
      reactWorkspaceRef.current?.stop();
      return;
    }
    const active = activeWorker.current;
    if (!active) return;
    activeWorker.current = null;
    active.worker.terminate();
    URL.revokeObjectURL(active.url);
    setOutput((current) => [...current, "■ Выполнение остановлено пользователем"]);
    setRunning(false);
  }, [board?.kind]);

  useEffect(() => () => {
    const active = activeWorker.current;
    if (!active) return;
    active.worker.terminate();
    URL.revokeObjectURL(active.url);
    activeWorker.current = null;
  }, []);

  const run = useCallback(() => {
    if (running) return;
    if (board?.kind === "REACT") {
      reactWorkspaceRef.current?.run();
      return;
    }
    if (window.matchMedia("(max-width: 760px)").matches) setMobileConsoleOpen(true);
    setRunning(true); setOutput(["▶ Запуск..."]);
    const js = ts.transpile(code, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, allowJs: true });
    const workerSource = createCodeWorkerSource(js);
    const blob = new Blob([workerSource], { type: "text/javascript" });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);
    activeWorker.current = { worker, url: workerUrl };
    const result: string[] = [];
    let settled = false;
    const finish = (nextOutput: string[]) => {
      if (settled) return;
      settled = true;
      if (activeWorker.current?.worker === worker) activeWorker.current = null;
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      setOutput(nextOutput);
      setRunning(false);
    };
    worker.onmessage = (event: MessageEvent<{ type: "log" | "error" | "done"; value?: string }>) => {
      if (event.data.type === "log") { result.push(event.data.value ?? ""); setOutput([...result]); }
      if (event.data.type === "error") finish([...result, `Ошибка: ${event.data.value ?? "Неизвестная ошибка"}`]);
      if (event.data.type === "done") finish(result.length ? result : ["✓ Выполнено без вывода"]);
    };
    worker.onerror = (event) => { event.preventDefault(); finish([...result, `Ошибка: ${event.message}`]); };
    worker.onmessageerror = () => finish([...result, "Ошибка: не удалось прочитать результат выполнения"]);
  }, [board?.kind, code, running]);

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

  const toggleTaskSidebar = () => {
    const next = !taskSidebarOpen;
    setTaskSidebarOpen(next);
    localStorage.setItem(TASK_SIDEBAR_KEY, String(next));
    if (!next) {
      setTaskSearchOpen(false);
      setTaskSearchQuery("");
    }
  };

  const toggleTaskSearch = () => {
    if (taskSearchOpen) {
      setTaskSearchOpen(false);
      setTaskSearchQuery("");
      return;
    }
    if (!taskSidebarOpen) {
      setTaskSidebarOpen(true);
      localStorage.setItem(TASK_SIDEBAR_KEY, "true");
    }
    setTaskSearchOpen(true);
  };

  if (loadError) {
    const accessError = loadError.status === 403 || loadError.status === 404;
    const authError = loadError.status === 401;
    const title = authError ? "Сессия закончилась" : accessError ? "Доска недоступна" : "Не удалось открыть доску";
    const description = authError
      ? "Войдите снова — после авторизации можно повторно открыть эту ссылку."
      : accessError
        ? "Возможно, у вас нет доступа, ссылка устарела или задача была удалена."
        : "Проверьте соединение с сервером приложения и попробуйте загрузить доску ещё раз.";
    return <div className="board-error" role="alert" aria-live="assertive"><section className="board-error__panel">
      <div className="board-error__signal"><WarningOutlined /><span>{loadError.status ? `HTTP ${loadError.status}` : "NO RESPONSE"}</span></div>
      <div className="eyebrow">BOARD ACCESS</div>
      <h1>{title}</h1>
      <p>{description}</p>
      <small>{loadError.message}</small>
      <div className="board-error__actions">
        <Link to={authError ? "/login" : "/"}><Button type="primary" size="large" icon={<HomeOutlined />}>{authError ? "Войти снова" : "В кабинет"}</Button></Link>
        <Button size="large" icon={<ReloadOutlined />} onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Повторить</Button>
      </div>
    </section></div>;
  }
  if (!board || board.id !== boardId) return <div className="board-loading"><Skeleton active paragraph={{ rows: 12 }} /></div>;
  const navigationBoards = workspaceBoards.length ? workspaceBoards : [board];
  const normalizedTaskSearch = taskSearchQuery.trim();
  return <div className="board-room">
    <header className="board-toolbar">
      <Link to={`/workspace/${workspaceId}`} className="board-toolbar__back"><ArrowLeftOutlined /></Link>
      <div className="board-toolbar__title"><span>{board.workspaceId ? "ЗАДАЧА" : "ДОСКА"} / {board.groupName?.toUpperCase() ?? "БЕЗ ГРУППЫ"}</span><h1>{board.title}</h1></div>
      <Tag className="language-tag">{board.kind === "REACT" ? `React 19 · ${board.language === "TYPESCRIPT" ? "TS" : "JS"}` : board.language === "TYPESCRIPT" ? "TypeScript" : "JavaScript"}</Tag>
      <div className="save-state">{saved ? <><CheckCircleFilled /> сохранено · v{board.version}</> : <><SaveOutlined /> сохраняем...</>}</div>
      <div className="presence"><Avatar.Group max={{ count: 3 }}>{presence.map((person) => <Tooltip title={person.displayName} key={person.id}><Avatar>{person.displayName.slice(0, 1)}</Avatar></Tooltip>)}</Avatar.Group><span><i /> {presence.length || 1} в комнате</span></div>
      <Button className="mobile-console-button" icon={<CodeOutlined />} aria-label="Открыть консоль вывода" onClick={() => setMobileConsoleOpen(true)}><span>Вывод</span></Button>
      <Button className={`run-button ${running ? "run-button--stop" : ""}`} type={running ? "default" : "primary"} danger={running} icon={running ? <StopOutlined /> : <PlayCircleFilled />} onClick={running ? stopRun : run} title={running ? "Остановить выполнение" : "Ctrl + Enter"}>{running ? "Остановить" : "Запустить"}</Button>
    </header>
    <div className={`board-workspace-shell ${taskSidebarOpen ? "board-workspace-shell--sidebar-open" : "board-workspace-shell--sidebar-collapsed"} ${taskSidebarOpen && taskSearchOpen ? "board-workspace-shell--searching" : ""}`}>
      {taskSidebarOpen && <button className="board-task-nav__scrim" type="button" aria-label="Закрыть список задач" onClick={toggleTaskSidebar} />}
      <aside className="board-task-nav" aria-label="Задачи рабочего пространства">
        <header>
          <div className="board-task-nav__heading"><span>WORKSPACE</span><b>{taskSearchOpen ? "Поиск" : "Задачи"}</b><small>{taskSearchOpen && normalizedTaskSearch.length >= 2 && !taskSearchLoading ? taskSearchResults.length : navigationBoards.length}</small></div>
          <div className="board-task-nav__actions">
            {taskSidebarOpen && <button className={taskSearchOpen ? "is-active" : ""} type="button" aria-label={taskSearchOpen ? "Закрыть поиск по задачам" : "Поиск по задачам"} aria-pressed={taskSearchOpen} title={taskSearchOpen ? "Закрыть поиск" : "Поиск по задачам"} onClick={toggleTaskSearch}><SearchOutlined /></button>}
            <button type="button" aria-label={taskSidebarOpen ? "Свернуть список задач" : "Развернуть список задач"} aria-expanded={taskSidebarOpen} onClick={toggleTaskSidebar}>{taskSidebarOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}</button>
          </div>
        </header>
        {taskSearchOpen && <div className="board-task-search"><Input autoFocus allowClear value={taskSearchQuery} prefix={<SearchOutlined />} placeholder="Код, условие, название..." aria-label="Строка поиска по всем задачам" onChange={(event) => setTaskSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") toggleTaskSearch(); }} /></div>}
        <nav aria-live={taskSearchOpen ? "polite" : undefined}>{taskSearchOpen ? <>
          {normalizedTaskSearch.length < 2 && <div className="board-task-search__state"><SearchOutlined /><b>Поиск по всему workspace</b><span>Введите минимум 2 символа. Ищем в коде, условиях, названиях и группах.</span></div>}
          {normalizedTaskSearch.length >= 2 && taskSearchLoading && <div className="board-task-search__state"><Spin size="small" /><b>Ищем совпадения</b><span>Запрос выполняется по серверному индексу.</span></div>}
          {normalizedTaskSearch.length >= 2 && !taskSearchLoading && taskSearchError && <div className="board-task-search__state board-task-search__state--error"><WarningOutlined /><b>Поиск недоступен</b><span>{taskSearchError}</span><Button size="small" icon={<ReloadOutlined />} onClick={() => setTaskSearchAttempt((attempt) => attempt + 1)}>Повторить</Button></div>}
          {normalizedTaskSearch.length >= 2 && !taskSearchLoading && !taskSearchError && taskSearchResults.length === 0 && <div className="board-task-search__state"><SearchOutlined /><b>Совпадений нет</b><span>Попробуйте другую строку или более короткий фрагмент кода.</span></div>}
          {!taskSearchLoading && !taskSearchError && taskSearchResults.map((result) => <Link className={`board-task-search__result ${result.id === boardId ? "is-active" : ""}`} to={`/workspace/${workspaceId}/board/${result.id}`} key={result.id} onClick={() => { if (window.innerWidth <= 760) { setTaskSidebarOpen(false); setTaskSearchOpen(false); setTaskSearchQuery(""); } }}>
            <span className="board-task-search__result-head"><i>{result.kind === "REACT" ? "R19" : result.language === "TYPESCRIPT" ? "TS" : "JS"}</i><b>{result.title}</b><small>{result.occurrences > 1 ? `${result.occurrences} совп.` : "1 совп."}</small></span>
            <em>{searchMatchLabel(result)}</em>
            <code>{result.snippet}</code>
          </Link>)}
        </> : navigationBoards.map((item) => <div className={`board-task-nav__row ${item.id === boardId ? "is-active" : ""}`} key={item.id}>
          <Link className="board-task-nav__item" to={`/workspace/${workspaceId}/board/${item.id}`} title={item.title} aria-label={`Открыть задачу «${item.title}»`} aria-current={item.id === boardId ? "page" : undefined} onClick={() => { if (window.innerWidth <= 760) setTaskSidebarOpen(false); }}>
            <span className="board-task-nav__language">{item.kind === "REACT" ? "R19" : item.language === "TYPESCRIPT" ? "TS" : "JS"}</span>
            <span className="board-task-nav__copy"><b>{item.title}</b><small>{item.groupName ?? "Без группы"}</small></span>
          </Link>
        </div>)}</nav>
        <footer><Link to={`/workspace/${workspaceId}`} aria-label="Все задачи"><AppstoreOutlined /><span>Все задачи</span></Link></footer>
      </aside>
      <div className={`board-workspace-content ${realtimeStatus === "error" ? "board-workspace-content--realtime-error" : ""}`}>
        {realtimeStatus === "error" && <div className="realtime-error" role="alert"><WarningOutlined /><div><b>Совместное редактирование недоступно</b><span>{realtimeError || "Не удалось подключиться к Socket.IO. Изменения пока не синхронизируются."}</span></div><Button size="small" icon={<ReloadOutlined />} onClick={retryRealtime}>Повторить</Button></div>}
        <section id="board-task-description" className={`board-context ${descriptionOpen ? "" : "board-context--collapsed"}`}><CodeOutlined /><div><span>УСЛОВИЕ</span>{descriptionOpen && <p>{board.description || "Условие не добавлено. Обсудите задачу прямо во время сессии."}</p>}</div><button className="board-context__toggle" type="button" aria-controls="board-task-description" aria-expanded={descriptionOpen} aria-label={descriptionOpen ? "Скрыть условие задачи" : "Показать условие задачи"} title={descriptionOpen ? "Скрыть условие" : "Показать условие"} onClick={() => setDescriptionOpen((open) => !open)}>{descriptionOpen ? <UpOutlined /> : <DownOutlined />}</button></section>
        {board.kind === "REACT" ? <ReactBoardWorkspace
          ref={reactWorkspaceRef}
          board={board}
          workspaceId={workspaceId}
          content={code}
          onContentChange={updateCode}
          onEditorMount={mountEditor}
          activeFileRef={activeFileRef}
          output={output}
          setOutput={setOutput}
          onRunningChange={setRunning}
        /> : <main className="editor-layout" style={{ "--session-pane-width": `${sessionWidth}px` } as CSSProperties}>
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
      </aside>
        </main>}
      </div>
    </div>
    <Drawer
      rootClassName="mobile-console-drawer"
      title={<span className="mobile-console-title">КОНСОЛЬ <i>OUTPUT</i></span>}
      extra={<div className="mobile-console-actions"><Button type="text" size="small" onClick={() => setOutput([])}>очистить</Button>{running && <Button danger type="text" size="small" icon={<StopOutlined />} onClick={stopRun}>стоп</Button>}</div>}
      placement="bottom"
      height="min(58dvh, 520px)"
      open={mobileConsoleOpen}
      onClose={() => setMobileConsoleOpen(false)}
    >
      <div className="mobile-console-output"><pre aria-live="polite">{output.map((line, i) => <span key={i}>{line}</span>)}</pre></div>
    </Drawer>
  </div>;
}
