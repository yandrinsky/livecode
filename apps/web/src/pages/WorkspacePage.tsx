import { AppstoreOutlined, ArrowRightOutlined, BarsOutlined, CopyOutlined, PlusOutlined, SearchOutlined, TeamOutlined } from "@ant-design/icons";
import { Button, Empty, Form, Input, Modal, Radio, Select, Segmented, Skeleton, Tag, message } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Pomodoro } from "../components/Pomodoro";
import { ActivityCalendar } from "../components/ActivityCalendar";
import type { Board, Workspace } from "../types";

export function WorkspacePage() {
  const { workspaceId = "" } = useParams();
  const { user } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"updatedAt" | "createdAt">("updatedAt");
  const [group, setGroup] = useState<string>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [boardModal, setBoardModal] = useState(false);
  const [inviteModal, setInviteModal] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const load = () => api<{ workspace: Workspace }>(`/workspaces/${workspaceId}`).then((r) => setWorkspace(r.workspace));
  useEffect(() => { void load(); }, [workspaceId]);
  const groups = [...new Set(workspace?.boards?.map((b) => b.groupName).filter(Boolean) as string[] ?? [])];
  const boards = useMemo(() => (workspace?.boards ?? []).filter((b) =>
    (group === "all" || b.groupName === group) && `${b.title} ${b.description}`.toLowerCase().includes(query.toLowerCase())
  ).sort((a, b) => new Date(b[sort]).getTime() - new Date(a[sort]).getTime()), [workspace, group, query, sort]);

  if (!workspace) return <div className="page-loading"><Skeleton active paragraph={{ rows: 8 }} /></div>;
  const createBoard = async (values: { title: string; description?: string; groupName?: string; language: Board["language"] }) => {
    try { await api(`/workspaces/${workspaceId}/boards`, { method: "POST", body: JSON.stringify(values) }); setBoardModal(false); await load(); }
    catch (error) { message.error(error instanceof Error ? error.message : "Не удалось создать задачу"); }
  };
  const invite = async ({ email }: { email: string }) => {
    try { const data = await api<{ invite: { acceptPath: string } }>(`/workspaces/${workspaceId}/invites`, { method: "POST", body: JSON.stringify({ email }) }); setInviteLink(`${location.origin}${data.invite.acceptPath}`); }
    catch (error) { message.error(error instanceof Error ? error.message : "Не удалось создать приглашение"); }
  };

  return <div className="workspace-page page-enter">
    <header className="workspace-hero"><div><div className="crumb">ПРОСТРАНСТВО / {workspace.owner.displayName.toUpperCase()}</div><h1>{workspace.name}</h1><p><TeamOutlined /> {workspace.members?.length ?? 1} участников <i/> {workspace.boards?.length ?? 0} сохранённых задач</p></div><div className="workspace-hero__actions">{workspace.ownerId === user?.id && <Button size="large" onClick={() => setInviteModal(true)}>Пригласить наставника</Button>}<Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setBoardModal(true)}>Новая задача</Button></div></header>
    <div className="workspace-tools">
      <Pomodoro workspaceId={workspace.id} initial={workspace.pomodoro} />
      <div className="practice-note"><span className="eyebrow">СЕГОДНЯШНИЙ РИТМ</span><h3>Одна задача.<br/>Один ясный шаг.</h3><p>Запустите таймер — его увидят все участники пространства.</p></div>
      <div className="member-stack"><span className="eyebrow">В КОМАНДЕ</span>{workspace.members?.map((member) => <div key={member.user.id}><span>{member.user.displayName.slice(0, 1)}</span><p><b>{member.user.displayName}</b><small>{member.role === "OWNER" ? "владелец" : "наставник"}</small></p></div>)}</div>
    </div>
    <ActivityCalendar workspace={workspace} />
    <div className="section-heading"><div><span>02</span><h2>Задачи</h2></div><small>{boards.length} из {workspace.boards?.length ?? 0}</small></div>
    <div className="board-filters"><Input allowClear prefix={<SearchOutlined />} placeholder="Найти задачу..." value={query} onChange={(e) => setQuery(e.target.value)} /><Select value={group} onChange={setGroup} options={[{ value: "all", label: "Все группы" }, ...groups.map((g) => ({ value: g, label: g }))]} /><Select value={sort} onChange={setSort} options={[{ value: "updatedAt", label: "Сначала изменённые" }, { value: "createdAt", label: "Сначала новые" }]} /><Segmented value={view} onChange={(v) => setView(v as typeof view)} options={[{ value: "grid", icon: <AppstoreOutlined /> }, { value: "list", icon: <BarsOutlined /> }]} /></div>
    {boards.length === 0 ? <Empty description="Здесь пока нет подходящих задач"><Button type="primary" onClick={() => setBoardModal(true)}>Создать первую</Button></Empty> : <section className={`board-grid board-grid--${view}`}>{boards.map((board) => <Link className="board-card" to={`/workspace/${workspace.id}/board/${board.id}`} key={board.id}>
      <div className="board-card__head"><Tag>{board.language === "TYPESCRIPT" ? "TS" : "JS"}</Tag><span>{board.groupName ?? "Без группы"}</span><small>{dayjs(board.updatedAt).format("D MMM · HH:mm")}</small></div>
      <h3>{board.title}</h3><p>{board.description || "Описание можно добавить позже."}</p>
      <pre>{board.content.split("\n").slice(0, 4).join("\n")}</pre>
      <footer><span>Версия {board.version}</span><b>Открыть доску <ArrowRightOutlined /></b></footer>
    </Link>)}</section>}
    <Modal title="Новая задача" open={boardModal} onCancel={() => setBoardModal(false)} footer={null} destroyOnHidden><Form layout="vertical" initialValues={{ language: "TYPESCRIPT" }} onFinish={createBoard}>
      <Form.Item label="Название" name="title" rules={[{ required: true, min: 2 }]}><Input size="large" autoFocus placeholder="Например, Развернуть связный список" /></Form.Item>
      <Form.Item label="Условие" name="description"><Input.TextArea rows={3} placeholder="Коротко опишите задачу" /></Form.Item>
      <Form.Item label="Группа" name="groupName"><Input placeholder="Массивы, графы, собеседование..." /></Form.Item>
      <Form.Item label="Язык" name="language"><Radio.Group optionType="button" buttonStyle="solid" options={[{ label: "TypeScript", value: "TYPESCRIPT" }, { label: "JavaScript", value: "JAVASCRIPT" }]} /></Form.Item>
      <Button block type="primary" size="large" htmlType="submit">Создать и открыть позже</Button>
    </Form></Modal>
    <Modal title="Пригласить наставника" open={inviteModal} onCancel={() => { setInviteModal(false); setInviteLink(""); }} footer={null}>{inviteLink ? <div className="invite-result"><p>Ссылка действует 7 дней и привязана к указанной почте.</p><Input value={inviteLink} readOnly suffix={<CopyOutlined onClick={() => { void navigator.clipboard.writeText(inviteLink); message.success("Ссылка скопирована"); }} />} /></div> : <Form layout="vertical" onFinish={invite}><Form.Item label="Почта наставника" name="email" rules={[{ required: true, type: "email" }]}><Input size="large" autoFocus placeholder="teacher@example.com" /></Form.Item><Button type="primary" block size="large" htmlType="submit">Создать приглашение</Button></Form>}</Modal>
  </div>;
}
