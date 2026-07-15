import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail loudly rather than silently signing tokens with a guessable
  // fallback secret — that would let anyone forge a session.
  throw new Error("JWT_SECRET environment variable is required. Set it in your .env file.");
}

const COOKIE_NAME = "session";
const TOKEN_TTL = "7d";

export interface SessionPayload {
  id: string;
  leetcodeUsername: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) return false; // account has no password set (shouldn't happen post-migration)
  return bcrypt.compare(password, hash);
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET!, { expiresIn: TOKEN_TTL });
}

export function setSessionCookie(res: Response, payload: SessionPayload): void {
  const token = signSession(payload);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME);
}

export function readSession(req: Request): SessionPayload | null {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET!) as SessionPayload;
  } catch {
    return null; // expired or tampered — treat as logged out
  }
}

// Express middleware: rejects the request unless a valid session cookie is
// present, and attaches the decoded session to req.user for handlers to use.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = readSession(req);
  if (!session) {
    return res.status(401).json({ error: "You must be logged in to do that." });
  }
  (req as any).user = session;
  next();
}
