import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { readToken, type AuthUser } from "./auth.js";
import { boardAccess, workspaceAccess } from "./access.js";
import { config } from "./config.js";
import { db } from "./db.js";

type PomodoroAction = { workspaceId: string; action: "start" | "pause" | "reset"; durationSeconds?: number };

export function attachRealtime(server: HttpServer) {
  const io = new Server(server, { cors: { origin: config.webOrigin, credentials: true } });

  io.use((socket, next) => {
    const user = readToken(socket.handshake.auth.token);
    if (!user) return next(new Error("unauthorized"));
    socket.data.user = user;
    next();
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as AuthUser;

    socket.on("workspace:join", async (workspaceId: string, ack?: (data: unknown) => void) => {
      if (!(await workspaceAccess(workspaceId, user.id))) return ack?.({ error: "forbidden" });
      await socket.join(`workspace:${workspaceId}`);
      const pomodoro = await db.pomodoro.findUnique({ where: { workspaceId } });
      ack?.({ pomodoro });
      io.to(`workspace:${workspaceId}`).emit("presence:update", roomUsers(io, `workspace:${workspaceId}`));
    });

    socket.on("board:join", async (boardId: string, ack?: (data: unknown) => void) => {
      const board = await boardAccess(boardId, user.id);
      if (!board) return ack?.({ error: "forbidden" });
      await socket.join(`board:${boardId}`);
      ack?.({ board });
      io.to(`board:${boardId}`).emit("presence:update", roomUsers(io, `board:${boardId}`));
    });

    socket.on("board:change", async ({ boardId, content }: { boardId: string; content: string }) => {
      const board = await boardAccess(boardId, user.id);
      if (!board || typeof content !== "string" || content.length > 1_000_000) return;
      const updated = await db.board.update({ where: { id: board.id }, data: { content, version: { increment: 1 } }, select: { version: true, updatedAt: true } });
      socket.to(`board:${boardId}`).emit("board:change", { boardId, content, version: updated.version, updatedAt: updated.updatedAt, user });
      socket.emit("board:saved", updated);
    });

    socket.on("pomodoro:action", async ({ workspaceId, action, durationSeconds }: PomodoroAction) => {
      if (!(await workspaceAccess(workspaceId, user.id))) return;
      const current = await db.pomodoro.findUnique({ where: { workspaceId } });
      const now = new Date();
      const duration = Math.min(3600, Math.max(60, durationSeconds ?? current?.durationSeconds ?? 1500));
      const liveRemaining = current?.status === "RUNNING" && current.endsAt
        ? Math.max(0, Math.ceil((current.endsAt.getTime() - now.getTime()) / 1000))
        : current?.remainingSeconds ?? duration;
      const data = action === "start"
        ? { status: "RUNNING" as const, durationSeconds: duration, remainingSeconds: liveRemaining || duration, startedAt: now, endsAt: new Date(now.getTime() + (liveRemaining || duration) * 1000), updatedById: user.id }
        : action === "pause"
          ? { status: "PAUSED" as const, remainingSeconds: liveRemaining, startedAt: null, endsAt: null, updatedById: user.id }
          : { status: "IDLE" as const, durationSeconds: duration, remainingSeconds: duration, startedAt: null, endsAt: null, updatedById: user.id };
      const pomodoro = await db.pomodoro.upsert({ where: { workspaceId }, create: { workspaceId, ...data }, update: data });
      io.to(`workspace:${workspaceId}`).emit("pomodoro:update", pomodoro);
    });

    socket.on("disconnecting", () => {
      for (const room of socket.rooms) {
        if (room !== socket.id) setTimeout(() => io.to(room).emit("presence:update", roomUsers(io, room)), 0);
      }
    });
  });
  return io;
}

function roomUsers(io: Server, room: string) {
  const ids = io.sockets.adapter.rooms.get(room) ?? new Set<string>();
  const unique = new Map<string, AuthUser>();
  for (const id of ids) {
    const user = io.sockets.sockets.get(id)?.data.user as AuthUser | undefined;
    if (user) unique.set(user.id, user);
  }
  return [...unique.values()];
}

