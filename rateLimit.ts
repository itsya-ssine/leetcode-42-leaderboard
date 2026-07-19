import rateLimit from "express-rate-limit";

// General ceiling applied to every /api/* request. The frontend polls
// /api/users and /api/trends every 15s, so this needs to stay generous
// for normal usage while still stopping scripted abuse.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this IP. Please slow down and try again shortly." }
});

// The 42 OAuth handshake (login redirect + callback). No legitimate user
// needs to hit this more than a handful of times in 15 minutes.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait a few minutes and try again." }
});

// Finishing enrollment creates a DB row and calls out to LeetCode —
// worth its own, stricter budget than general API traffic.
export const enrollLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many enrollment attempts. Please try again later." }
});

// Refresh routes call out to LeetCode's (itself rate-limited) API on the
// caller's behalf — throttle per-IP so one person can't hammer LeetCode
// through us.
export const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many refresh requests. Please wait a minute and try again." }
});
