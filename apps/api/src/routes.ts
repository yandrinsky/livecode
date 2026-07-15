import { randomBytes } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "./db.js";
import { requireAuth, signToken } from "./auth.js";
import { boardAccess, workspaceAccess } from "./access.js";

export const routes = Router();

const asyncRoute = (handler: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => Promise.resolve(handler(req, res)).catch(next);

routes.get("/health", (_req, res) => res.json({ status: "ok" }));

routes.post("/auth/register", asyncRoute(async (req, res) => {
  const data = z.object({
    email: z.string().email().transform((v) => v.toLowerCase()),
    password: z.string().min(8),
    displayName: z.string().trim().min(2).max(50),
  }).parse(req.body);
  if (await db.user.findUnique({ where: { email: data.email } })) {
    return res.status(409).json({ message: "Аккаунт с такой почтой уже существует" });
  }
  const user = await db.user.create({ data: { email: data.email, displayName: data.displayName, passwordHash: await bcrypt.hash(data.password, 12) } });
  const safe = { id: user.id, email: user.email, displayName: user.displayName };
  res.status(201).json({ user: safe, token: signToken(safe) });
}));

routes.post("/auth/login", asyncRoute(async (req, res) => {
  const data = z.object({ email: z.string().email().transform((v) => v.toLowerCase()), password: z.string() }).parse(req.body);
  const user = await db.user.findUnique({ where: { email: data.email } });
  if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) {
    return res.status(401).json({ message: "Неверная почта или пароль" });
  }
  const safe = { id: user.id, email: user.email, displayName: user.displayName };
  res.json({ user: safe, token: signToken(safe) });
}));

routes.use(requireAuth);
routes.get("/auth/me", (req, res) => res.json({ user: req.user }));

routes.get("/workspaces", asyncRoute(async (req, res) => {
  const workspaces = await db.workspace.findMany({
    where: { OR: [{ ownerId: req.user.id }, { members: { some: { userId: req.user.id } } }] },
    include: {
      owner: { select: { id: true, displayName: true, email: true } },
      _count: { select: { boards: true, members: true } },
      pomodoro: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  res.json({ workspaces });
}));

routes.post("/workspaces", asyncRoute(async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(2).max(80) }).parse(req.body);
  const workspace = await db.workspace.create({
    data: {
      name,
      ownerId: req.user.id,
      members: { create: { userId: req.user.id, role: "OWNER" } },
      pomodoro: { create: {} },
    },
    include: { owner: { select: { id: true, displayName: true, email: true } }, _count: { select: { boards: true, members: true } }, pomodoro: true },
  });
  res.status(201).json({ workspace });
}));

routes.get("/workspaces/:workspaceId", asyncRoute(async (req, res) => {
  const access = await workspaceAccess(req.params.workspaceId, req.user.id);
  if (!access) return res.status(404).json({ message: "Рабочее пространство не найдено" });
  const workspace = await db.workspace.findUnique({
    where: { id: access.id },
    include: {
      owner: { select: { id: true, displayName: true, email: true } },
      members: { include: { user: { select: { id: true, displayName: true, email: true } } } },
      boards: { orderBy: { updatedAt: "desc" }, include: { createdBy: { select: { id: true, displayName: true } } } },
      pomodoro: true,
    },
  });
  res.json({ workspace });
}));

routes.post("/workspaces/:workspaceId/boards", asyncRoute(async (req, res) => {
  const access = await workspaceAccess(req.params.workspaceId, req.user.id);
  if (!access) return res.status(404).json({ message: "Рабочее пространство не найдено" });
  const data = z.object({
    title: z.string().trim().min(2).max(100),
    description: z.string().max(1000).default(""),
    groupName: z.string().trim().max(50).nullable().optional(),
    language: z.enum(["TYPESCRIPT", "JAVASCRIPT"]).default("TYPESCRIPT"),
  }).parse(req.body);
  const starter = data.language === "TYPESCRIPT"
    ? "type Result = { value: number };\n\nexport function solve(input: number[]): Result {\n  // Начните решение здесь\n  return { value: 0 };\n}\n"
    : "export function solve(input) {\n  // Начните решение здесь\n  return { value: 0 };\n}\n";
  const board = await db.board.create({ data: { ...data, groupName: data.groupName || null, content: starter, workspaceId: access.id, createdById: req.user.id } });
  res.status(201).json({ board });
}));

routes.get("/boards/:boardId", asyncRoute(async (req, res) => {
  const board = await db.board.findFirst({
    where: { id: req.params.boardId, workspace: { OR: [{ ownerId: req.user.id }, { members: { some: { userId: req.user.id } } }] } },
    include: { workspace: { select: { id: true, name: true } }, createdBy: { select: { id: true, displayName: true } } },
  });
  if (!board) return res.status(404).json({ message: "Доска не найдена" });
  res.json({ board });
}));

routes.post("/boards/:boardId/activity", asyncRoute(async (req, res) => {
  const board = await boardAccess(req.params.boardId, req.user.id);
  if (!board) return res.status(404).json({ message: "Доска не найдена" });
  const pomodoro = await db.pomodoro.findUnique({ where: { workspaceId: board.workspaceId } });
  if (pomodoro?.status !== "RUNNING" || !pomodoro.endsAt || pomodoro.endsAt <= new Date()) {
    return res.status(204).end();
  }
  const minute = new Date();
  minute.setUTCSeconds(0, 0);
  await db.boardActivityMinute.upsert({
    where: { userId_minute: { userId: req.user.id, minute } },
    create: { userId: req.user.id, boardId: board.id, minute },
    update: { boardId: board.id },
  });
  res.status(204).end();
}));

routes.get("/workspaces/:workspaceId/activity", asyncRoute(async (req, res) => {
  const access = await workspaceAccess(req.params.workspaceId, req.user.id);
  if (!access) return res.status(404).json({ message: "Рабочее пространство не найдено" });
  const query = z.object({
    userId: z.string().uuid(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezoneOffset: z.coerce.number().int().min(-840).max(840).default(0),
  }).parse(req.query);
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: access.id, userId: query.userId } },
    include: { user: { select: { id: true, displayName: true } } },
  });
  if (!member) return res.status(404).json({ message: "Участник пространства не найден" });
  const start = new Date(`${query.from}T00:00:00.000Z`);
  const end = new Date(`${query.to}T00:00:00.000Z`);
  start.setUTCMinutes(start.getUTCMinutes() + query.timezoneOffset);
  end.setUTCDate(end.getUTCDate() + 1);
  end.setUTCMinutes(end.getUTCMinutes() + query.timezoneOffset);
  if (end.getTime() - start.getTime() > 370 * 864e5) return res.status(400).json({ message: "Период не должен превышать 370 дней" });
  const pulses = await db.boardActivityMinute.findMany({
    where: { userId: query.userId, board: { workspaceId: access.id }, minute: { gte: start, lt: end } },
    select: { minute: true, board: { select: { id: true, title: true } } },
    orderBy: { minute: "asc" },
  });
  const days = new Map<string, { date: string; seconds: number; boards: Map<string, { id: string; title: string; seconds: number }> }>();
  for (const pulse of pulses) {
    const localMinute = new Date(pulse.minute.getTime() - query.timezoneOffset * 60_000);
    const date = localMinute.toISOString().slice(0, 10);
    const day = days.get(date) ?? { date, seconds: 0, boards: new Map() };
    const board = day.boards.get(pulse.board.id) ?? { ...pulse.board, seconds: 0 };
    day.seconds += 60;
    board.seconds += 60;
    day.boards.set(board.id, board);
    days.set(date, day);
  }
  res.json({
    user: member.user,
    days: [...days.values()].map((day) => ({ ...day, boards: [...day.boards.values()].sort((a, b) => b.seconds - a.seconds) })),
  });
}));

routes.patch("/boards/:boardId", asyncRoute(async (req, res) => {
  const board = await db.board.findFirst({ where: { id: req.params.boardId, workspace: { OR: [{ ownerId: req.user.id }, { members: { some: { userId: req.user.id } } }] } } });
  if (!board) return res.status(404).json({ message: "Доска не найдена" });
  const data = z.object({
    title: z.string().trim().min(2).max(100).optional(),
    description: z.string().max(1000).optional(),
    groupName: z.string().trim().max(50).nullable().optional(),
    language: z.enum(["TYPESCRIPT", "JAVASCRIPT"]).optional(),
  }).parse(req.body);
  res.json({ board: await db.board.update({ where: { id: board.id }, data: { ...data, groupName: data.groupName || null } }) });
}));

routes.delete("/boards/:boardId", asyncRoute(async (req, res) => {
  const board = await db.board.findFirst({ where: { id: req.params.boardId, workspace: { ownerId: req.user.id } } });
  if (!board) return res.status(403).json({ message: "Удалить доску может только владелец пространства" });
  await db.board.delete({ where: { id: board.id } });
  res.status(204).end();
}));

routes.post("/workspaces/:workspaceId/invites", asyncRoute(async (req, res) => {
  const workspace = await db.workspace.findFirst({ where: { id: req.params.workspaceId, ownerId: req.user.id } });
  if (!workspace) return res.status(403).json({ message: "Приглашения создаёт владелец пространства" });
  const invite = await db.workspaceInvite.create({
    data: { workspaceId: workspace.id, createdById: req.user.id, token: randomBytes(24).toString("hex"), expiresAt: new Date(Date.now() + 7 * 864e5) },
  });
  res.status(201).json({ invite: { token: invite.token, expiresAt: invite.expiresAt, acceptPath: `/invite/${invite.token}` } });
}));

routes.get("/invites/:token", asyncRoute(async (req, res) => {
  const invite = await db.workspaceInvite.findUnique({
    where: { token: req.params.token },
    select: {
      acceptedAt: true,
      expiresAt: true,
      workspace: { select: { id: true, name: true } },
      createdBy: { select: { displayName: true } },
    },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) return res.status(404).json({ message: "Приглашение недействительно" });
  res.json({ invite: { workspace: invite.workspace, createdBy: invite.createdBy, expiresAt: invite.expiresAt } });
}));

routes.post("/invites/:token/accept", asyncRoute(async (req, res) => {
  const workspaceId = await db.$transaction(async (tx) => {
    const invite = await tx.workspaceInvite.findUnique({ where: { token: req.params.token } });
    if (!invite) return null;

    const claimed = await tx.workspaceInvite.updateMany({
      where: { id: invite.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) return null;

    await tx.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: req.user.id } },
      create: { workspaceId: invite.workspaceId, userId: req.user.id },
      update: {},
    });
    return invite.workspaceId;
  });
  if (!workspaceId) return res.status(404).json({ message: "Приглашение недействительно" });
  res.json({ workspaceId });
}));
