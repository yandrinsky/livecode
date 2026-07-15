import { AppstoreOutlined, ArrowRightOutlined, BarsOutlined, CopyOutlined, LinkOutlined, PlusOutlined, SearchOutlined, TeamOutlined } from "@ant-design/icons";
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
  const [inviteCreating, setInviteCreating] = useState(false);
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
  const invite = async () => {
    setInviteCreating(true);
    try { const data = await api<{ invite: { acceptPath: string } }>(`/workspaces/${workspaceId}/invites`, { method: "POST" }); setInviteLink(`${location.origin}${data.invite.acceptPath}`); }
    catch (error) { message.error(error instanceof Error ? error.message : "Не удалось создать приглашение"); }
    finally { setInviteCreating(false); }
  };

  return <div className="workspace-page page-enter">
    <header className="workspace-hero"><div><div className="crumb">ПРОСТРАНСТВО / {workspace.owner.displayName.toUpperCase()}</div><h1>{workspace.name}</h1><p><TeamOutlined /> {workspace.members?.length ?? 1} участников <i/> {workspace.boards?.length ?? 0} сохранённых задач</p></div><div className="workspace-hero__actions">{workspace.ownerId === user?.id && <Button size="large" onClick={() => setInviteModal(true)}>Пригласить участника</Button>}<Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setBoardModal(true)}>Новая задача</Button></div></header>
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
    <Modal title="Одноразовое приглашение" open={inviteModal} onCancel={() => { setInviteModal(false); setInviteLink(""); }} footer={null}>{inviteLink ? <div className="invite-result">
      <div className="invite-result__status"><span>LINK READY</span><b>Доступ готов</b></div>
      <p>Ссылка действует 7 дней и сработает только один раз. Доступ получит первый вошедший пользователь, который её примет.</p>
      <Input value={inviteLink} readOnly aria-label="Одноразовая ссылка приглашения" suffix={<Button type="text" aria-label="Скопировать ссылку" icon={<CopyOutlined />} onClick={() => { void navigator.clipboard.writeText(inviteLink).then(() => message.success("Ссылка скопирована")).catch(() => message.error("Не удалось скопировать ссылку")); }} />} />
    </div> : <div className="invite-create">
      <div className="invite-create__icon"><LinkOutlined /></div>
      <h3>Без адреса и лишних шагов</h3>
      <p>Отправьте ссылку нужному человеку. Email заранее указывать не нужно.</p>
      <ul><li>активна 7 дней</li><li>сгорает после первого принятия</li><li>создать может только владелец</li></ul>
      <Button type="primary" block size="large" icon={<LinkOutlined />} loading={inviteCreating} onClick={() => void invite()}>Создать одноразовую ссылку</Button>
    </div>}</Modal>
  </div>;
}
