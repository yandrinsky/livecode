import { Button, Result, Skeleton, message } from "antd";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";

export function InvitePage() {
  const { token = "" } = useParams(); const navigate = useNavigate();
  const [invite, setInvite] = useState<{ workspace: { name: string }; createdBy: { displayName: string }; expiresAt: string } | null>(null);
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [accepting, setAccepting] = useState(false);
  useEffect(() => {
    let active = true;
    setInvite(null);
    setError("");
    api<{ invite: NonNullable<typeof invite> }>(`/invites/${token}`)
      .then((result) => { if (active) setInvite(result.invite); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Приглашение недействительно"); });
    return () => { active = false; };
  }, [token, loadAttempt]);
  if (error) return <Result status="warning" title="Не удалось проверить приглашение" subTitle={error} extra={[<Button type="primary" size="large" key="retry" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Повторить</Button>, <Button size="large" key="home" onClick={() => navigate("/")}>Вернуться в кабинет</Button>]} />;
  if (!invite) return <div className="page-loading"><Skeleton active /></div>;
  const accept = async () => {
    setAccepting(true);
    try { const result = await api<{ workspaceId: string }>(`/invites/${token}/accept`, { method: "POST" }); navigate(`/workspace/${result.workspaceId}`); }
    catch (reason) { message.error(reason instanceof Error ? reason.message : "Не удалось принять приглашение"); setAccepting(false); }
  };
  return <Result status="info" title={`Вас приглашают в «${invite.workspace.name}»`} subTitle={`${invite.createdBy.displayName} открыл одноразовый доступ. После принятия ссылка перестанет работать.`} extra={<Button type="primary" size="large" loading={accepting} onClick={() => void accept()}>Принять приглашение</Button>} />;
}
