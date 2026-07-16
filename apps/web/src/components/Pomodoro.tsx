import { PauseOutlined, PlayCircleFilled, ReloadOutlined } from "@ant-design/icons";
import { Button, InputNumber, Tooltip, message, notification } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { liveSocket } from "../socket";
import type { Pomodoro as PomodoroType } from "../types";

type TimerResult = { pomodoro?: PomodoroType; error?: string };
type CompletedTimer = { workspaceId: string; completedPhase: "FOCUS" | "BREAK"; pomodoro: PomodoroType };

export function Pomodoro({ workspaceId, initial, compact = false }: { workspaceId: string; initial?: PomodoroType; compact?: boolean }) {
  const [timer, setTimer] = useState<PomodoroType | undefined>(initial);
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState(false);
  const completionSentFor = useRef<string | null>(null);
  const socket = useMemo(liveSocket, []);
  const [notificationApi, contextHolder] = notification.useNotification();

  useEffect(() => {
    const update = (next: PomodoroType) => {
      setTimer(next);
      if (next.endsAt !== completionSentFor.current) completionSentFor.current = null;
    };
    const completed = (event: CompletedTimer) => {
      if (event.workspaceId !== workspaceId || event.completedPhase !== "FOCUS") return;
      notificationApi.open({
        message: "Время сделать перерыв",
        description: "Фокус-сессия завершена. Пятиминутный перерыв уже начался.",
        placement: "topRight",
        duration: 8,
      });
    };
    socket.emit("workspace:join", workspaceId, (data: { pomodoro?: PomodoroType }) => data.pomodoro && setTimer(data.pomodoro));
    socket.on("pomodoro:update", update);
    socket.on("pomodoro:completed", completed);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      socket.emit("workspace:leave", workspaceId);
      socket.off("pomodoro:update", update);
      socket.off("pomodoro:completed", completed);
      window.clearInterval(tick);
    };
  }, [notificationApi, socket, workspaceId]);

  const remaining = timer?.status === "RUNNING" && timer.endsAt
    ? Math.max(0, Math.ceil((new Date(timer.endsAt).getTime() - now) / 1000))
    : timer?.remainingSeconds ?? 1500;

  useEffect(() => {
    if (timer?.status !== "RUNNING" || !timer.endsAt || remaining > 0 || completionSentFor.current === timer.endsAt) return;
    completionSentFor.current = timer.endsAt;
    socket.emit("pomodoro:complete", workspaceId, (result: TimerResult) => {
      if (result.error) {
        completionSentFor.current = null;
        void message.error(result.error);
      } else if (result.pomodoro) setTimer(result.pomodoro);
    });
  }, [remaining, socket, timer, workspaceId]);

  const minutes = Math.floor(remaining / 60).toString().padStart(2, "0");
  const seconds = (remaining % 60).toString().padStart(2, "0");
  const action = (name: "start" | "pause" | "reset", durationSeconds?: number) => {
    if (pending) return;
    setPending(true);
    const fallback = window.setTimeout(() => {
      setPending(false);
      void message.error("Сервер не подтвердил действие с таймером");
    }, 5000);
    socket.emit("pomodoro:action", { workspaceId, action: name, durationSeconds }, (result: TimerResult) => {
      window.clearTimeout(fallback);
      setPending(false);
      if (result.error) void message.error(result.error);
      else if (result.pomodoro) setTimer(result.pomodoro);
    });
  };
  const isBreak = timer?.phase === "BREAK";
  const status = isBreak
    ? timer?.status === "RUNNING" ? "ПЕРЕРЫВ ИДЁТ" : "ПЕРЕРЫВ НА ПАУЗЕ"
    : timer?.status === "RUNNING" ? "ФОКУС ИДЁТ" : timer?.status === "PAUSED" ? "ПАУЗА" : "ФОКУС-СЕССИЯ";

  return <>
    {contextHolder}
    <div className={`pomodoro ${timer?.status === "RUNNING" ? "is-running" : ""} ${isBreak ? "is-break" : ""} ${compact ? "is-compact" : ""}`}>
      <div className="pomodoro__status"><span className="live-dot" /> {status}</div>
      <div className="pomodoro__time">{minutes}<i>:</i>{seconds}</div>
      {!compact && <InputNumber
        className="pomodoro__duration"
        min={1} max={60} suffix="мин"
        value={Math.round((timer?.durationSeconds ?? 1500) / 60)}
        disabled={timer?.status === "RUNNING" || pending}
        onChange={(value) => action("reset", Number(value ?? 25) * 60)}
      />}
      <div className="pomodoro__actions">
        {timer?.status === "RUNNING"
          ? <Tooltip title="Поставить на паузу"><Button loading={pending} shape="circle" icon={<PauseOutlined />} onClick={() => action("pause")} /></Tooltip>
          : <Button loading={pending} className="pomodoro__start" icon={<PlayCircleFilled />} onClick={() => action("start")}>Старт</Button>}
        <Tooltip title="Сбросить"><Button disabled={pending} type="text" shape="circle" icon={<ReloadOutlined />} onClick={() => action("reset")} /></Tooltip>
      </div>
    </div>
  </>;
}
