import { Spin } from "antd";
import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { AppShell } from "./components/AppShell";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { InvitePage } from "./pages/InvitePage";
import { WorkspacePage } from "./pages/WorkspacePage";

const BoardPage = lazy(() => import("./pages/BoardPage").then((module) => ({ default: module.BoardPage })));

function Protected({ shell = true }: { shell?: boolean }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="boot"><Spin size="large" /></div>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return shell ? <AppShell><Outlet /></AppShell> : <Outlet />;
}

export default function App() {
  return <Routes>
    <Route path="/login" element={<AuthPage />} /><Route path="/register" element={<AuthPage />} />
    <Route element={<Protected />}><Route index element={<DashboardPage />} /><Route path="workspace/:workspaceId" element={<WorkspacePage />} /><Route path="invite/:token" element={<InvitePage />} /></Route>
    <Route element={<Protected shell={false} />}><Route path="workspace/:workspaceId/board/:boardId" element={<Suspense fallback={<div className="boot"><Spin size="large" /></div>}><BoardPage /></Suspense>} /></Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
