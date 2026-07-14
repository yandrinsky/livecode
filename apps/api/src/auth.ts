import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config.js";

export type AuthUser = { id: string; email: string; displayName: string };

declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

export function signToken(user: AuthUser) {
  return jwt.sign(user, config.jwtSecret, { expiresIn: "14d" });
}

export function readToken(token?: string): AuthUser | null {
  if (!token) return null;
  try { return jwt.verify(token, config.jwtSecret) as AuthUser; }
  catch { return null; }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const user = readToken(header?.startsWith("Bearer ") ? header.slice(7) : undefined);
  if (!user) return res.status(401).json({ message: "Нужно войти в аккаунт" });
  req.user = user;
  next();
}

