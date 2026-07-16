import { ArrowRightOutlined, PlusOutlined, TeamOutlined } from "@ant-design/icons";
import { Button, Form, Input, Modal, Skeleton, message } from "antd";
import dayjs from "dayjs";
import "dayjs/locale/ru";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { DataLoadError } from "../components/DataLoadError";
import type { Workspace } from "../types";

dayjs.locale("ru");

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setWorkspaces(null);
    setLoadError("");
    api<{ workspaces: Workspace[] }>("/workspaces")
      .then((result) => { if (active) setWorkspaces(result.workspaces); })
      .catch((reason: unknown) => { if (active) setLoadError(reason instanceof Error ? reason.message : "Не удалось загрузить пространства"); });
    return () => { active = false; };
  }, [loadAttempt]);
  const create = async ({ name }: { name: string }) => {
    try { const { workspace } = await api<{ workspace: Workspace }>("/workspaces", { method: "POST", body: JSON.stringify({ name }) }); navigate(`/workspace/${workspace.id}`); }
    catch (error) { message.error(error instanceof Error ? error.message : "Не удалось создать пространство"); }
  };

  return <div className="dashboard page-enter">
    <header className="page-header"><div><span className="eyebrow">ВАША ПРАКТИКА</span><h1>Добрый день, {user?.displayName.split(" ")[0]}</h1><p>Возвращайтесь к задаче или подготовьте новую сессию.</p></div><Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setParams({ create: "1" })}>Новое пространство</Button></header>
    <section className="metric-strip">
      <div><span>ПРОСТРАНСТВ</span><b>{workspaces?.length ?? "—"}</b></div>
      <div><span>СОХРАНЕНО ЗАДАЧ</span><b>{workspaces?.reduce((sum, w) => sum + (w._count?.boards ?? 0), 0) ?? "—"}</b></div>
      <div><span>СОВМЕСТНАЯ РАБОТА</span><b className="online"><i /> online</b></div>
    </section>
    <div className="section-heading"><div><span>01</span><h2>Рабочие пространства</h2></div><small>Обновлены недавно</small></div>
    <section className="workspace-grid">
      {loadError ? <DataLoadError message={loadError} onRetry={() => setLoadAttempt((attempt) => attempt + 1)} /> : !workspaces ? [...Array(3)].map((_, i) => <Skeleton key={i} active />) : <>{workspaces.map((workspace, index) => <Link className="workspace-card" to={`/workspace/${workspace.id}`} key={workspace.id} style={{ animationDelay: `${index * 70}ms` }}>
        <div className="workspace-card__top"><span className="card-number">/{String(index + 1).padStart(2, "0")}</span><span className="workspace-card__role">{workspace.ownerId === user?.id ? "ВЛАДЕЛЕЦ" : "УЧАСТНИК"}</span></div>
        <h3>{workspace.name}</h3><p>{workspace.ownerId === user?.id ? "Ваше пространство для практики" : `Пространство · ${workspace.owner.displayName}`}</p>
        <div className="workspace-card__meta"><span><b>{workspace._count?.boards ?? 0}</b> задач</span><span><TeamOutlined /> {(workspace._count?.members ?? 0)} участников</span></div>
        <footer><span>Изменено {dayjs(workspace.updatedAt).format("D MMM · HH:mm")}</span><ArrowRightOutlined /></footer>
      </Link>)}<button className="workspace-card workspace-card--new" onClick={() => setParams({ create: "1" })}><PlusOutlined /><b>Создать пространство</b><span>Отдельное место для курса, темы или ученика</span></button></>}
    </section>
    <Modal title="Новое рабочее пространство" open={params.get("create") === "1"} onCancel={() => setParams({})} footer={null} destroyOnHidden>
      <Form layout="vertical" onFinish={create}><Form.Item label="Название" name="name" rules={[{ required: true, min: 2 }]}><Input autoFocus size="large" placeholder="Например, Алгоритмы · осень" /></Form.Item><Button block type="primary" size="large" htmlType="submit">Создать</Button></Form>
    </Modal>
  </div>;
}
