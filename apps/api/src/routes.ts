import { randomBytes } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "./db.js";
import { requireAuth, signToken } from "./auth.js";
import { workspaceAccess } from "./access.js";

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
  const { email } = z.object({ email: z.string().email().transform((v) => v.toLowerCase()) }).parse(req.body);
  const invite = await db.workspaceInvite.create({
    data: { email, workspaceId: workspace.id, createdById: req.user.id, token: randomBytes(24).toString("hex"), expiresAt: new Date(Date.now() + 7 * 864e5) },
  });
  res.status(201).json({ invite: { ...invite, acceptPath: `/invite/${invite.token}` } });
}));

routes.get("/invites/:token", asyncRoute(async (req, res) => {
  const invite = await db.workspaceInvite.findUnique({ where: { token: req.params.token }, include: { workspace: true, createdBy: { select: { displayName: true } } } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) return res.status(404).json({ message: "Приглашение недействительно" });
  res.json({ invite });
}));

routes.post("/invites/:token/accept", asyncRoute(async (req, res) => {
  const invite = await db.workspaceInvite.findUnique({ where: { token: req.params.token } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) return res.status(404).json({ message: "Приглашение недействительно" });
  if (invite.email !== req.user.email) return res.status(403).json({ message: `Приглашение выписано на ${invite.email}` });
  await db.$transaction([
    db.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: req.user.id } }, create: { workspaceId: invite.workspaceId, userId: req.user.id }, update: {} }),
    db.workspaceInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
  ]);
  res.json({ workspaceId: invite.workspaceId });
}));
