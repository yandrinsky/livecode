import { CalendarOutlined, ClockCircleOutlined } from "@ant-design/icons";
import { Empty, Select, Skeleton, Tooltip } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { DataLoadError } from "./DataLoadError";
import type { ActivityDay, Workspace } from "../types";

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.max(1, Math.round((seconds % 3600) / 60));
  return hours ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
};

export function ActivityCalendar({ workspace }: { workspace: Workspace }) {
  const [userId, setUserId] = useState(workspace.ownerId);
  const [days, setDays] = useState<ActivityDay[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const end = useMemo(() => dayjs().startOf("day"), []);
  const start = useMemo(() => end.subtract(364, "day"), [end]);

  useEffect(() => {
    let active = true;
    setDays(null);
    setLoadError("");
    setSelectedDate(null);
    const params = new URLSearchParams({
      userId,
      from: start.format("YYYY-MM-DD"),
      to: end.format("YYYY-MM-DD"),
      timezoneOffset: String(new Date().getTimezoneOffset()),
    });
    api<{ days: ActivityDay[] }>(`/workspaces/${workspace.id}/activity?${params}`)
      .then((result) => { if (active) setDays(result.days); })
      .catch((reason: unknown) => { if (active) setLoadError(reason instanceof Error ? reason.message : "Не удалось загрузить активность"); });
    return () => { active = false; };
  }, [workspace.id, userId, start, end, loadAttempt]);

  const dayMap = useMemo(() => new Map(days?.map((day) => [day.date, day]) ?? []), [days]);
  const cells = useMemo(() => {
    const first = start.subtract(start.day(), "day");
    const last = end.add(6 - end.day(), "day");
    const result: dayjs.Dayjs[] = [];
    for (let date = first; !date.isAfter(last, "day"); date = date.add(1, "day")) result.push(date);
    return result;
  }, [start, end]);
  const selected = selectedDate ? dayMap.get(selectedDate) : undefined;
  const maxSeconds = Math.max(1, ...(days?.map((day) => day.seconds) ?? []));
  const level = (seconds: number) => seconds === 0 ? 0 : Math.max(1, Math.ceil((seconds / maxSeconds) * 4));

  return <section className="activity-card">
    <header className="activity-card__header">
      <div><span className="eyebrow"><CalendarOutlined /> АКТИВНОСТЬ ЗА ГОД</span><h2>Учебный ритм</h2></div>
      <Select
        value={userId}
        onChange={setUserId}
        options={workspace.members?.map(({ user }) => ({ value: user.id, label: user.displayName }))}
      />
    </header>
    {loadError ? <DataLoadError compact message={loadError} onRetry={() => setLoadAttempt((attempt) => attempt + 1)} /> : !days ? <Skeleton active paragraph={{ rows: 4 }} /> : <>
      <div className="activity-calendar-scroll">
        <div className="activity-calendar" aria-label="Календарь учебной активности">
          {cells.map((date) => {
            const key = date.format("YYYY-MM-DD");
            const activity = dayMap.get(key);
            const inRange = !date.isBefore(start, "day") && !date.isAfter(end, "day");
            const title = activity
              ? `${date.format("D MMM YYYY")} · ${formatDuration(activity.seconds)} · ${activity.boards.length} задач`
              : `${date.format("D MMM YYYY")} · активности нет`;
            return <Tooltip title={title} key={key}>
              <button
                className={`activity-day level-${level(activity?.seconds ?? 0)} ${inRange ? "" : "is-outside"} ${selectedDate === key ? "is-selected" : ""}`}
                aria-label={title}
                disabled={!inRange}
                onClick={() => setSelectedDate(key)}
              />
            </Tooltip>;
          })}
        </div>
      </div>
      <footer className="activity-legend"><span>Меньше</span>{[0, 1, 2, 3, 4].map((value) => <i className={`level-${value}`} key={value} />)}<span>Больше</span></footer>
      {selectedDate && <div className="activity-detail">
        <div><b>{dayjs(selectedDate).format("D MMMM YYYY")}</b><span><ClockCircleOutlined /> {selected ? formatDuration(selected.seconds) : "активности нет"}</span></div>
        {!selected ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="В этот день задачи не открывали" /> : <ul>{selected.boards.map((board) => <li key={board.id}>
          <Link to={`/workspace/${workspace.id}/board/${board.id}`}>{board.title}</Link><span>{formatDuration(board.seconds)}</span>
        </li>)}</ul>}
      </div>}
    </>}
  </section>;
}
