import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { User } from "./types";

type AuthContextValue = { user: User | null; ready: boolean; authenticate: (token: string, user: User) => void; logout: () => void };
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem("pairboard_token")) return setReady(true);
    api<{ user: User }>("/auth/me").then((data) => setUser(data.user)).catch(() => localStorage.removeItem("pairboard_token")).finally(() => setReady(true));
  }, []);
  const value = useMemo(() => ({
    user, ready,
    authenticate(token: string, nextUser: User) { localStorage.setItem("pairboard_token", token); setUser(nextUser); },
    logout() { localStorage.removeItem("pairboard_token"); setUser(null); },
  }), [user, ready]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}
