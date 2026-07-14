import { ArrowLeftOutlined, CheckCircleFilled, CloseOutlined, CodeOutlined, PlayCircleFilled, SaveOutlined, TeamOutlined } from "@ant-design/icons";
import Editor from "@monaco-editor/react";
import { Avatar, Button, Skeleton, Tag, Tooltip, message } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ts from "typescript";
import { api } from "../api";
import { Pomodoro } from "../components/Pomodoro";
import { liveSocket } from "../socket";
import type { Board, User } from "../types";

export function BoardPage() {
  const { workspaceId = "", boardId = "" } = useParams();
  const socket = useMemo(liveSocket, []);
  const [board, setBoard] = useState<Board | null>(null);
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(true);
  const [presence, setPresence] = useState<User[]>([]);
  const [output, setOutput] = useState<string[]>(["Готово к запуску. Добавьте console.log, чтобы увидеть результат."]);
  const [running, setRunning] = useState(false);
  const remote = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    api<{ board: Board }>(`/boards/${boardId}`).then(({ board: value }) => { setBoard(value); setCode(value.content); });
  }, [boardId]);

  useEffect(() => {
    const onChange = (data: { boardId: string; content: string; version: number }) => {
      if (data.boardId !== boardId) return;
      remote.current = true; setCode(data.content); setSaved(true); setBoard((b) => b ? { ...b, version: data.version } : b);
    };
    const onSaved = (data: { version: number }) => { setSaved(true); setBoard((b) => b ? { ...b, version: data.version } : b); };
    socket.emit("workspace:join", workspaceId);
    socket.emit("board:join", boardId);
    socket.on("board:change", onChange); socket.on("board:saved", onSaved); socket.on("presence:update", setPresence);
    return () => { socket.off("board:change", onChange); socket.off("board:saved", onSaved); socket.off("presence:update", setPresence); };
  }, [socket, workspaceId, boardId]);

  const updateCode = (value = "") => {
    setCode(value);
    if (remote.current) { remote.current = false; return; }
    setSaved(false); window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => socket.emit("board:change", { boardId, content: value }), 500);
  };

  const run = () => {
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
  };

  if (!board) return <div className="board-loading"><Skeleton active paragraph={{ rows: 12 }} /></div>;
  return <div className="board-room">
    <header className="board-toolbar">
      <Link to={`/workspace/${workspaceId}`} className="board-toolbar__back"><ArrowLeftOutlined /></Link>
      <div className="board-toolbar__title"><span>{board.workspaceId ? "ЗАДАЧА" : "ДОСКА"} / {board.groupName?.toUpperCase() ?? "БЕЗ ГРУППЫ"}</span><h1>{board.title}</h1></div>
      <Tag className="language-tag">{board.language === "TYPESCRIPT" ? "TypeScript" : "JavaScript"}</Tag>
      <div className="save-state">{saved ? <><CheckCircleFilled /> сохранено · v{board.version}</> : <><SaveOutlined /> сохраняем...</>}</div>
      <div className="presence"><Avatar.Group max={{ count: 3 }}>{presence.map((person) => <Tooltip title={person.displayName} key={person.id}><Avatar>{person.displayName.slice(0, 1)}</Avatar></Tooltip>)}</Avatar.Group><span><i /> {presence.length || 1} в комнате</span></div>
      <Button className="run-button" type="primary" icon={<PlayCircleFilled />} loading={running} onClick={run}>Запустить</Button>
    </header>
    <section className="board-context"><CodeOutlined /><div><span>УСЛОВИЕ</span><p>{board.description || "Условие не добавлено. Обсудите задачу прямо во время сессии."}</p></div><button><CloseOutlined /></button></section>
    <main className="editor-layout">
      <div className="editor-pane">
        <div className="editor-tab"><span>{board.title.toLowerCase().replaceAll(" ", "-")}.{board.language === "TYPESCRIPT" ? "ts" : "js"}</span><small><TeamOutlined /> LIVE</small></div>
        <Editor
          height="100%"
          language={board.language === "TYPESCRIPT" ? "typescript" : "javascript"}
          value={code}
          theme="vs-dark"
          onChange={updateCode}
          beforeMount={(monaco) => monaco.editor.defineTheme("pairboard-dark", { base: "vs-dark", inherit: true, rules: [], colors: { "editor.background": "#0b0e12", "editor.lineHighlightBackground": "#11161c", "editorCursor.foreground": "#9bff65", "editor.selectionBackground": "#2d4a3f88", "editorLineNumber.foreground": "#3d4652", "editorLineNumber.activeForeground": "#8d99a8" } })}
          onMount={(_, monaco) => monaco.editor.setTheme("pairboard-dark")}
          options={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, lineHeight: 24, minimap: { enabled: false }, padding: { top: 18 }, smoothScrolling: true, cursorSmoothCaretAnimation: "on", formatOnPaste: true, tabSize: 2, wordWrap: "on" }}
        />
      </div>
      <aside className="session-pane">
        <Pomodoro workspaceId={workspaceId} compact />
        <div className="console"><header><span>КОНСОЛЬ</span><button onClick={() => setOutput([])}>очистить</button></header><pre>{output.map((line, i) => <span key={i}>{line}</span>)}</pre></div>
        <div className="session-tip"><span>ПОДСКАЗКА НАСТАВНИКУ</span><p>Дайте ученику проговорить идею до первой строки кода.</p></div>
      </aside>
    </main>
  </div>;
}
