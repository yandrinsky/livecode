import { Button, Result, Skeleton, message } from "antd";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";

export function InvitePage() {
  const { token = "" } = useParams(); const navigate = useNavigate();
  const [invite, setInvite] = useState<{ workspace: { name: string }; createdBy: { displayName: string }; email: string } | null>(null);
  useEffect(() => { api<{ invite: typeof invite }>(`/invites/${token}`).then((r) => setInvite(r.invite)).catch((e) => message.error(e.message)); }, [token]);
  if (!invite) return <div className="page-loading"><Skeleton active /></div>;
  const accept = async () => { try { const result = await api<{ workspaceId: string }>(`/invites/${token}/accept`, { method: "POST" }); navigate(`/workspace/${result.workspaceId}`); } catch (e) { message.error(e instanceof Error ? e.message : "Не удалось принять приглашение"); } };
  return <Result status="info" title={`Вас приглашают в «${invite.workspace.name}»`} subTitle={`${invite.createdBy.displayName} открыл доступ для ${invite.email}`} extra={<Button type="primary" size="large" onClick={accept}>Принять приглашение</Button>} />;
}
