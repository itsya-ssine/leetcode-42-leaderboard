import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail loudly rather than silently signing tokens with a guessable
  // fallback secret — that would let anyone forge a session.
  throw new Error("JWT_SECRET environment variable is required. Set it in your .env file.");
}

const COOKIE_NAME = "session";
const FULL_SESSION_TTL = "7d";
const FULL_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Pending sessions only exist to bridge "just signed in with 42" ->
// "picked a LeetCode username" — they don't need to live long.
const PENDING_SESSION_TTL = "15m";
const PENDING_SESSION_MAX_AGE_MS = 15 * 60 * 1000;

// A fully enrolled cadet: verified 42 identity already linked to a
// LeetCode username. This is the only kind of session that can act on
// the API (view protected routes, delete their own account, etc).
export interface FullSession {
  kind: "full";
  id: string;
  leetcodeUsername: string;
}

// Someone who has authenticated with 42 but hasn't finished enrolling
// yet. Every field here comes straight from 42's own API (never from
// user-submitted input), so it can be trusted when creating the account.
export interface PendingSession {
  kind: "pending";
  intraId: string; // 42 login, e.g. "jdoe" — unique on 42's platform
  intraDisplayName: string;
  intraAvatarUrl?: string;
}

export type SessionPayload = FullSession | PendingSession;

// Older tokens (issued before the 42/pending split existed) only ever
// carried {id, leetcodeUsername} with no "kind" field. Treat those as
// full sessions so existing logged-in users aren't booted on deploy.
function normalizeSession(decoded: any): SessionPayload | null {
  if (!decoded || typeof decoded !== "object") return null;
  if (decoded.kind === "full" || decoded.kind === "pending") return decoded as SessionPayload;
  if (typeof decoded.id === "string" && typeof decoded.leetcodeUsername === "string") {
    return { kind: "full", id: decoded.id, leetcodeUsername: decoded.leetcodeUsername };
  }
  return null;
}

export function signSession(payload: SessionPayload): string {
  const ttl = payload.kind === "full" ? FULL_SESSION_TTL : PENDING_SESSION_TTL;
  return jwt.sign(payload, JWT_SECRET!, { expiresIn: ttl });
}

export function setSessionCookie(res: Response, payload: SessionPayload): void {
  const token = signSession(payload);
  const maxAge = payload.kind === "full" ? FULL_SESSION_MAX_AGE_MS : PENDING_SESSION_MAX_AGE_MS;
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME);
}

export function readSession(req: Request): SessionPayload | null {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    return normalizeSession(jwt.verify(token, JWT_SECRET!));
  } catch {
    return null; // expired or tampered — treat as logged out
  }
}

// Express middleware: rejects the request unless a fully enrolled session
// (42 identity + linked LeetCode username) is present, and attaches the
// decoded session to req.user for handlers to use.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = readSession(req);
  if (!session || session.kind !== "full") {
    return res.status(401).json({ error: "You must be logged in to do that." });
  }
  (req as any).user = session;
  next();
}

// Express middleware for the in-between state: signed in with 42, not
// enrolled yet. Used to gate the "finish enrollment" endpoint so it can
// only ever use 42-verified identity data, never client-supplied intraId.
export function requirePendingAuth(req: Request, res: Response, next: NextFunction) {
  const session = readSession(req);
  if (!session || session.kind !== "pending") {
    return res.status(401).json({ error: "Please sign in with your 42 (Intra) account first." });
  }
  (req as any).pending = session;
  next();
}
