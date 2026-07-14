import { io, type Socket } from "socket.io-client";
import { API_URL } from "./api";

let socket: Socket | null = null;
export function liveSocket() {
  if (!socket) socket = io(API_URL, { auth: { token: localStorage.getItem("pairboard_token") }, autoConnect: false });
  if (!socket.connected) { socket.auth = { token: localStorage.getItem("pairboard_token") }; socket.connect(); }
  return socket;
}

export function disconnectLiveSocket() {
  socket?.disconnect();
  socket = null;
}
