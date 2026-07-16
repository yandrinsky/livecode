import { PauseOutlined, PlayCircleFilled, ReloadOutlined, WarningOutlined } from "@ant-design/icons";
import { Button, InputNumber, Tooltip } from "antd";
import { useEffect, useState } from "react";
import { useLiveSocket } from "../socket";
import type { Pomodoro as PomodoroType } from "../types";

export function Pomodoro({ workspaceId, initial, compact = false }: { workspaceId: string; initial?: PomodoroType; compact?: boolean }) {
  const [timer, setTimer] = useState<PomodoroType | undefined>(initial);
  const [now, setNow] = useState(Date.now());
  const { socket, status: realtimeStatus, error: realtimeError, retry: retryRealtime } = useLiveSocket();

  useEffect(() => {
    const update = (next: PomodoroType) => setTimer(next);
    const joinWorkspace = () => socket.emit("workspace:join", workspaceId, (data: { pomodoro?: PomodoroType }) => data.pomodoro && setTimer(data.pomodoro));
    joinWorkspace();
    socket.on("connect", joinWorkspace);
    socket.on("pomodoro:update", update);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { socket.emit("workspace:leave", workspaceId); socket.off("connect", joinWorkspace); socket.off("pomodoro:update", update); window.clearInterval(tick); };
  }, [socket, workspaceId]);

  const remaining = timer?.status === "RUNNING" && timer.endsAt
    ? Math.max(0, Math.ceil((new Date(timer.endsAt).getTime() - now) / 1000))
    : timer?.remainingSeconds ?? 1500;
  const minutes = Math.floor(remaining / 60).toString().padStart(2, "0");
  const seconds = (remaining % 60).toString().padStart(2, "0");
  const action = (name: "start" | "pause" | "reset", durationSeconds?: number) => socket.emit("pomodoro:action", { workspaceId, action: name, durationSeconds });

  return <div className={`pomodoro ${timer?.status === "RUNNING" ? "is-running" : ""} ${compact ? "is-compact" : ""}`}>
    <div className="pomodoro__status"><span className="live-dot" /> {timer?.status === "RUNNING" ? "ФОКУС ИДЁТ" : timer?.status === "PAUSED" ? "ПАУЗА" : "ФОКУС-СЕССИЯ"}</div>
    <div className="pomodoro__time">{minutes}<i>:</i>{seconds}</div>
    {!compact && <InputNumber
      className="pomodoro__duration"
      min={1} max={60} suffix="мин"
      value={Math.round((timer?.durationSeconds ?? 1500) / 60)}
      disabled={timer?.status === "RUNNING" || realtimeStatus !== "connected"}
      onChange={(value) => action("reset", Number(value ?? 25) * 60)}
    />}
    <div className="pomodoro__actions">
      {timer?.status === "RUNNING"
        ? <Tooltip title="Поставить на паузу"><Button shape="circle" disabled={realtimeStatus !== "connected"} icon={<PauseOutlined />} onClick={() => action("pause")} /></Tooltip>
        : <Button className="pomodoro__start" disabled={realtimeStatus !== "connected"} icon={<PlayCircleFilled />} onClick={() => action("start")}>Старт</Button>}
      <Tooltip title="Сбросить"><Button type="text" shape="circle" disabled={realtimeStatus !== "connected"} icon={<ReloadOutlined />} onClick={() => action("reset")} /></Tooltip>
    </div>
    {!compact && realtimeStatus === "error" && <div className="pomodoro__connection-error" role="alert"><WarningOutlined /><span><b>Нет realtime-соединения</b><small>{realtimeError}</small></span><Button type="text" size="small" onClick={retryRealtime}>Повторить</Button></div>}
  </div>;
}
