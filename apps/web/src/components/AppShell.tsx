import { CodeOutlined, LogoutOutlined, PlusOutlined } from "@ant-design/icons";
import { Avatar, Button, Dropdown, Skeleton } from "antd";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import type { Workspace } from "../types";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  useEffect(() => { api<{ workspaces: Workspace[] }>("/workspaces").then((r) => setWorkspaces(r.workspaces)); }, [location.pathname]);

  return <div className="app-shell">
    <aside className="rail">
      <Link className="brand" to="/"><span className="brand__mark"><CodeOutlined /></span><span>PAIR<br/>BOARD</span></Link>
      <div className="rail__label">Пространства</div>
      <nav className="workspace-nav">
        {!workspaces ? <Skeleton active paragraph={{ rows: 3 }} title={false} /> : workspaces.map((workspace, index) =>
          <Link className={`workspace-link ${location.pathname.includes(workspace.id) ? "is-active" : ""}`} key={workspace.id} to={`/workspace/${workspace.id}`}>
            <span className="workspace-link__index">{String(index + 1).padStart(2, "0")}</span>
            <span>{workspace.name}</span>
            <small>{workspace._count?.boards ?? "·"}</small>
          </Link>)}
      </nav>
      <Button className="rail__create" type="text" icon={<PlusOutlined />} onClick={() => navigate("/?create=1")}>Новое пространство</Button>
      <div className="rail__account">
        <Dropdown menu={{ items: [{ key: "logout", icon: <LogoutOutlined />, label: "Выйти", onClick: () => { logout(); navigate("/login"); } }] }} placement="topLeft">
          <button><Avatar>{user?.displayName.slice(0, 1)}</Avatar><span><b>{user?.displayName}</b><small>{user?.email}</small></span></button>
        </Dropdown>
      </div>
    </aside>
    <main className="main-stage">{children}</main>
  </div>;
}
