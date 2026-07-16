import { io, type Socket } from "socket.io-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL } from "./api";

let socket: Socket | null = null;
const SOCKET_TIMEOUT_MS = 10_000;

export function liveSocket() {
  if (!socket) socket = io(API_URL, { auth: { token: localStorage.getItem("pairboard_token") }, autoConnect: false });
  if (!socket.connected) { socket.auth = { token: localStorage.getItem("pairboard_token") }; socket.connect(); }
  return socket;
}

export function useLiveSocket() {
  const activeSocket = useMemo(liveSocket, []);
  const [status, setStatus] = useState<"connecting" | "connected" | "error">(activeSocket.connected ? "connected" : "connecting");
  const [error, setError] = useState("");

  useEffect(() => {
    let timeout = 0;
    const clearConnectionTimeout = () => window.clearTimeout(timeout);
    const awaitConnection = () => {
      clearConnectionTimeout();
      setStatus("connecting");
      setError("");
      timeout = window.setTimeout(() => {
        if (activeSocket.connected) return;
        setStatus("error");
        setError("Сервер совместной работы не ответил за 10 секунд.");
      }, SOCKET_TIMEOUT_MS);
    };
    const handleConnect = () => {
      clearConnectionTimeout();
      setStatus("connected");
      setError("");
    };
    const handleConnectError = (reason: Error) => {
      clearConnectionTimeout();
      setStatus("error");
      setError(reason.message || "Не удалось установить realtime-соединение.");
    };
    const handleDisconnect = () => awaitConnection();

    activeSocket.on("connect", handleConnect);
    activeSocket.on("connect_error", handleConnectError);
    activeSocket.on("disconnect", handleDisconnect);
    if (activeSocket.connected) handleConnect(); else awaitConnection();

    return () => {
      clearConnectionTimeout();
      activeSocket.off("connect", handleConnect);
      activeSocket.off("connect_error", handleConnectError);
      activeSocket.off("disconnect", handleDisconnect);
    };
  }, [activeSocket]);

  const retry = useCallback(() => {
    setStatus("connecting");
    setError("");
    activeSocket.auth = { token: localStorage.getItem("pairboard_token") };
    activeSocket.disconnect().connect();
  }, [activeSocket]);

  return { socket: activeSocket, status, error, retry };
}

export function disconnectLiveSocket() {
  socket?.disconnect();
  socket = null;
}
