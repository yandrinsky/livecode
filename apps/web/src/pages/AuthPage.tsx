import { ArrowRightOutlined, CodeOutlined } from "@ant-design/icons";
import { Button, Form, Input, Segmented, message } from "antd";
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import type { User } from "../types";

export function AuthPage() {
  const { user, authenticate } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<"login" | "register">(location.pathname.includes("register") ? "register" : "login");
  const [loading, setLoading] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const submit = async (values: { email: string; password: string; displayName?: string }) => {
    setLoading(true);
    try {
      const data = await api<{ user: User; token: string }>(`/auth/${mode}`, { method: "POST", body: JSON.stringify(values) });
      authenticate(data.token, data.user); navigate((location.state as { from?: string } | null)?.from ?? "/");
    } catch (error) { message.error(error instanceof Error ? error.message : "Не удалось войти"); }
    finally { setLoading(false); }
  };

  return <div className="auth-page">
    <div className="auth-orbit auth-orbit--one" /><div className="auth-orbit auth-orbit--two" />
    <section className="auth-story">
      <div className="brand brand--large"><span className="brand__mark"><CodeOutlined /></span><span>PAIRBOARD</span></div>
      <div className="auth-story__copy">
        <span className="eyebrow"><i /> LIVE CODING SPACE</span>
        <h1>Решение видно.<br/><em>Прогресс остаётся.</em></h1>
        <p>Спокойное рабочее место ученика и наставника — с живым кодом, историей задач и единым ритмом фокус-сессии.</p>
      </div>
      <div className="auth-code-card"><div><i/><i/><i/><span>solution.ts</span></div><pre><span>export function</span> grow(skill) {'{'}{"\n"}  <b>return</b> practice(skill){"\n"}{'}'}</pre><small>● наставник уже в комнате</small></div>
    </section>
    <section className="auth-panel">
      <div className="auth-form-wrap">
        <Segmented block value={mode} onChange={(value) => setMode(value as typeof mode)} options={[{ label: "Войти", value: "login" }, { label: "Создать аккаунт", value: "register" }]} />
        <header><span className="eyebrow">ДОБРО ПОЖАЛОВАТЬ</span><h2>{mode === "login" ? "Продолжим практику" : "Создайте свою доску"}</h2><p>{mode === "login" ? "Ваши решения ждут вас там, где вы остановились." : "Первое рабочее пространство займёт меньше минуты."}</p></header>
        <Form layout="vertical" requiredMark={false} onFinish={submit}>
          {mode === "register" && <Form.Item label="Как вас называть" name="displayName" rules={[{ required: true, min: 2 }]}><Input size="large" placeholder="Имя или псевдоним" /></Form.Item>}
          <Form.Item label="Электронная почта" name="email" rules={[{ required: true, type: "email" }]}><Input size="large" placeholder="you@example.com" /></Form.Item>
          <Form.Item label="Пароль" name="password" rules={[{ required: true, min: 8, message: "Минимум 8 символов" }]}><Input.Password size="large" placeholder="Не короче 8 символов" /></Form.Item>
          <Button htmlType="submit" type="primary" size="large" block loading={loading}> {mode === "login" ? "Войти в Pairboard" : "Создать аккаунт"} <ArrowRightOutlined /></Button>
        </Form>
        <button className="demo-hint" onClick={() => void submit({ email: "student@pairboard.local", password: "pairboard123" })}>Демо-вход: <b>ученик</b> / пароль pairboard123</button>
      </div>
    </section>
  </div>;
}
