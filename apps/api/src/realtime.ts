import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { readToken, type AuthUser } from "./auth.js";
import { boardAccess, workspaceAccess } from "./access.js";
import { config } from "./config.js";
import { db } from "./db.js";

type PomodoroAction = { workspaceId: string; action: "start" | "pause" | "reset"; durationSeconds?: number };
type PomodoroAck = (data: { pomodoro?: unknown; error?: string }) => void;
type BoardSelection = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

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
      const pomodoro = await completeExpiredPomodoro(io, workspaceId) ?? await db.pomodoro.findUnique({ where: { workspaceId } });
      ack?.({ pomodoro });
      io.to(`workspace:${workspaceId}`).emit("presence:update", roomUsers(io, `workspace:${workspaceId}`));
    });

    socket.on("workspace:leave", async (workspaceId: string) => {
      const room = `workspace:${workspaceId}`;
      await socket.leave(room);
      io.to(room).emit("presence:update", roomUsers(io, room));
    });

    socket.on("board:join", async (boardId: string, ack?: (data: unknown) => void) => {
      const board = await boardAccess(boardId, user.id);
      if (!board) return ack?.({ error: "forbidden" });
      await socket.join(`board:${boardId}`);
      ack?.({ board });
      io.to(`board:${boardId}`).emit("presence:update", roomUsers(io, `board:${boardId}`));
    });

    socket.on("board:leave", async (boardId: string) => {
      const room = `board:${boardId}`;
      socket.to(room).emit("board:selection-clear", { boardId, clientId: socket.id, userId: user.id });
      await socket.leave(room);
      io.to(room).emit("presence:update", roomUsers(io, room));
    });

    socket.on("board:selection", ({ boardId, selection }: { boardId: string; selection: BoardSelection }) => {
      const room = `board:${boardId}`;
      if (!socket.rooms.has(room) || !validSelection(selection)) return;
      socket.to(room).emit("board:selection", { boardId, selection, clientId: socket.id, user });
    });

    socket.on("board:change", async ({ boardId, content }: { boardId: string; content: string }) => {
      const board = await boardAccess(boardId, user.id);
      if (!board || typeof content !== "string" || content.length > 1_000_000) return;
      const updated = await db.board.update({ where: { id: board.id }, data: { content, version: { increment: 1 } }, select: { version: true, updatedAt: true } });
      socket.to(`board:${boardId}`).emit("board:change", { boardId, content, version: updated.version, updatedAt: updated.updatedAt, user });
      socket.emit("board:saved", updated);
    });

    socket.on("pomodoro:action", async ({ workspaceId, action, durationSeconds }: PomodoroAction, ack?: PomodoroAck) => {
      try {
        if (!(await workspaceAccess(workspaceId, user.id))) return ack?.({ error: "Нет доступа к таймеру" });
        const current = await db.pomodoro.findUnique({ where: { workspaceId } });
        const now = new Date();
        const duration = Math.min(3600, Math.max(60, durationSeconds ?? current?.durationSeconds ?? 1500));
        const phaseDuration = current?.phase === "BREAK" ? current.breakDurationSeconds : duration;
        const liveRemaining = current?.status === "RUNNING" && current.endsAt
          ? Math.max(0, Math.ceil((current.endsAt.getTime() - now.getTime()) / 1000))
          : current?.remainingSeconds ?? phaseDuration;
        const startRemaining = durationSeconds === undefined ? (liveRemaining || phaseDuration) : duration;
        const data = action === "start"
          ? { status: "RUNNING" as const, durationSeconds: duration, remainingSeconds: startRemaining, startedAt: now, endsAt: new Date(now.getTime() + startRemaining * 1000), updatedById: user.id }
          : action === "pause"
            ? { status: "PAUSED" as const, remainingSeconds: liveRemaining, startedAt: null, endsAt: null, updatedById: user.id }
            : { status: "IDLE" as const, phase: "FOCUS" as const, durationSeconds: duration, remainingSeconds: duration, startedAt: null, endsAt: null, updatedById: user.id };
        const pomodoro = await db.pomodoro.upsert({ where: { workspaceId }, create: { workspaceId, ...data }, update: data });
        io.to(`workspace:${workspaceId}`).emit("pomodoro:update", pomodoro);
        ack?.({ pomodoro });
      } catch (error) {
        console.error("pomodoro:action failed", error);
        ack?.({ error: "Не удалось обновить таймер" });
      }
    });

    socket.on("pomodoro:complete", async (workspaceId: string, ack?: PomodoroAck) => {
      try {
        if (!(await workspaceAccess(workspaceId, user.id))) return ack?.({ error: "Нет доступа к таймеру" });
        const pomodoro = await completeExpiredPomodoro(io, workspaceId);
        ack?.({ pomodoro: pomodoro ?? await db.pomodoro.findUnique({ where: { workspaceId } }) });
      } catch (error) {
        console.error("pomodoro:complete failed", error);
        ack?.({ error: "Не удалось завершить интервал" });
      }
    });

    socket.on("disconnecting", () => {
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          if (room.startsWith("board:")) {
            socket.to(room).emit("board:selection-clear", { boardId: room.slice(6), clientId: socket.id, userId: user.id });
          }
          setTimeout(() => io.to(room).emit("presence:update", roomUsers(io, room)), 0);
        }
      }
    });
  });
  return io;
}

async function completeExpiredPomodoro(io: Server, workspaceId: string) {
  const current = await db.pomodoro.findUnique({ where: { workspaceId } });
  const now = new Date();
  if (!current || current.status !== "RUNNING" || !current.endsAt || current.endsAt > now) return null;

  const completedPhase = current.phase;
  const next = completedPhase === "FOCUS"
    ? { phase: "BREAK" as const, status: "RUNNING" as const, remainingSeconds: current.breakDurationSeconds, startedAt: now, endsAt: new Date(now.getTime() + current.breakDurationSeconds * 1000) }
    : { phase: "FOCUS" as const, status: "IDLE" as const, remainingSeconds: current.durationSeconds, startedAt: null, endsAt: null };
  const changed = await db.pomodoro.updateMany({
    where: { workspaceId, status: "RUNNING", phase: current.phase, endsAt: { lte: now }, updatedAt: current.updatedAt },
    data: next,
  });
  if (!changed.count) return null;

  const pomodoro = await db.pomodoro.findUniqueOrThrow({ where: { workspaceId } });
  io.to(`workspace:${workspaceId}`).emit("pomodoro:update", pomodoro);
  io.to(`workspace:${workspaceId}`).emit("pomodoro:completed", { workspaceId, completedPhase, pomodoro });
  return pomodoro;
}

function validSelection(value: unknown): value is BoardSelection {
  if (!value || typeof value !== "object") return false;
  const selection = value as Record<string, unknown>;
  return ["startLineNumber", "startColumn", "endLineNumber", "endColumn"].every((key) =>
    Number.isInteger(selection[key]) && Number(selection[key]) >= 1 && Number(selection[key]) <= 10_000_000
  );
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
