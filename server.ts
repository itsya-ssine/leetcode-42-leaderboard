import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import path from "path";
import "dotenv/config";
import { User, HistoryRecord } from "./src/types.js";
import {
  initDb,
  listUsers,
  getUserById,
  getUserByIntraId,
  findDuplicate,
  insertUser,
  updateUser,
  deleteUserById,
  getMeta,
  setMeta
} from "./db.js";
import {
  setSessionCookie,
  clearSessionCookie,
  readSession,
  requireAuth,
  requirePendingAuth,
  PendingSession
} from "./auth.js";
import { buildAuthorizeUrl, exchangeCodeForToken, fetchIntraProfile, IntraAuthError } from "./intra.js";
import { apiLimiter, authLimiter, enrollLimiter, refreshLimiter } from "./rateLimit.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Needed so express-rate-limit (and req.protocol below) see the real
// client IP / original scheme when running behind a reverse proxy
// (Vercel, Render, Railway, etc.) instead of the proxy's own address.
app.set("trust proxy", 1);

// The exact callback URL 42 will redirect back to. Must be identical to
// what's registered on the 42 OAuth app AND what's sent in both the
// /authorize and /token requests. Falling back to a computed URL is
// convenient for local dev, but on most hosts you should set
// INTRA_REDIRECT_URI explicitly since preview URLs / proxies can make the
// computed host unreliable.
function getRedirectUri(req: express.Request): string {
  if (process.env.INTRA_REDIRECT_URI) return process.env.INTRA_REDIRECT_URI;
  return `${req.protocol}://${req.get("host")}/api/auth/42/callback`;
}

// Thrown when a source positively confirms the username doesn't exist on LeetCode.
class LeetCodeUserNotFoundError extends Error {
  constructor(username: string) {
    super(`LeetCode user "${username}" doesn't exist.`);
    this.name = "LeetCodeUserNotFoundError";
  }
}

// Thrown when every source failed to respond (network/timeout/rate limit) —
// we genuinely don't know whether the user exists, so we must not guess.
class LeetCodeUnavailableError extends Error {
  constructor(username: string) {
    super(
      `Couldn't verify LeetCode user "${username}" right now — LeetCode's API may be temporarily unavailable. Try again in a moment.`
    );
    this.name = "LeetCodeUnavailableError";
  }
}

app.use(express.json());
app.use(cookieParser());

// General ceiling on all API traffic. Individual sensitive routes below
// (OAuth handshake, enrollment, LeetCode-scraping refreshes) layer a
// stricter, route-specific limiter on top of this one.
app.use("/api", apiLimiter);

// dbReady gates every request behind initDb() completing at least once.
// On a persistent host this resolves once at boot. On Vercel, the module
// (and this promise) is created once per cold-started function instance and
// reused for every invocation handled by that instance, so this still only
// runs once per instance rather than once per request. Registered before
// any routes below so it actually applies to all of them.
const dbReady = initDb();
app.use((req, res, next) => {
  dbReady.then(() => next()).catch(next);
});

// Utility to calculate ranks and progress metrics
function sortAndRankUsers(users: User[]) {
  // We sort primarily by Weekly Progress (to encourage active, weekly problem solving momentum!)
  // In case of a tie, we sort by All-Time solved counts
  users.sort((a, b) => {
    if (b.weeklyProgress !== a.weeklyProgress) {
      return b.weeklyProgress - a.weeklyProgress;
    }
    return b.allTimeSolved - a.allTimeSolved;
  });

  users.forEach((u, index) => {
    u.rank = index + 1;
  });
}

// Fetches real solved-problem counts for a LeetCode username.
// Throws LeetCodeUserNotFoundError when a source positively confirms the
// username doesn't exist, or LeetCodeUnavailableError when every source
// failed to respond and we can't tell either way. Never invents numbers.
//
// Note: weekly/monthly progress is NOT computed here. LeetCode's public,
// unauthenticated recentAcSubmissionList endpoint silently caps at ~20
// records no matter what "limit" you pass, so anyone who solved more than
// ~20 problems in a week would get silently undercounted. Instead, weekly/
// monthly progress is derived from our own stored history snapshots — see
// computeProgressFromHistory() below, called by the route handlers.
async function scrapeLeetCodeProfile(username: string): Promise<{
  allTimeSolved: number;
  easySolved: number;
  mediumSolved: number;
  hardSolved: number;
  source: string;
  avatarUrl?: string;
}> {
  const cleanUsername = username.trim();
  let confirmedNotFound = false;

  // 1. Official LeetCode GraphQL endpoint (same one leetcode.com's own frontend calls)
  try {
    const query = `
      query userProblemsSolved($username: String!) {
        matchedUser(username: $username) {
          profile {
            userAvatar
          }
          submitStatsGlobal {
            acSubmissionNum {
              difficulty
              count
            }
          }
        }
      }
    `;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Referer": "https://leetcode.com",
        "Origin": "https://leetcode.com"
      },
      body: JSON.stringify({ query, variables: { username: cleanUsername } }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const json: any = await response.json();
      const matchedUser = json?.data?.matchedUser;

      if (matchedUser === null) {
        // LeetCode explicitly returns matchedUser: null for a username
        // that doesn't exist — this is a confirmed answer, not a failure.
        confirmedNotFound = true;
      } else {
        const acSubmissions = matchedUser?.submitStatsGlobal?.acSubmissionNum;
        if (acSubmissions && acSubmissions.length > 0) {
          const all = acSubmissions.find((x: any) => x.difficulty === "All")?.count || 0;
          const easy = acSubmissions.find((x: any) => x.difficulty === "Easy")?.count || 0;
          const medium = acSubmissions.find((x: any) => x.difficulty === "Medium")?.count || 0;
          const hard = acSubmissions.find((x: any) => x.difficulty === "Hard")?.count || 0;

          let avatarUrl = matchedUser?.profile?.userAvatar;
          if (avatarUrl && avatarUrl.startsWith("/")) {
            avatarUrl = `https://leetcode.com${avatarUrl}`;
          }

          return {
            allTimeSolved: all,
            easySolved: easy,
            mediumSolved: medium,
            hardSolved: hard,
            source: "Official GraphQL",
            avatarUrl: avatarUrl || undefined
          };
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Fetch] Official LeetCode GraphQL failed/timed out: ${err.message}`);
  }

  // 2. Alfa LeetCode API (public wrapper around the same GraphQL data)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(`https://alfa-leetcode-api.onrender.com/userProfile/${cleanUsername}`, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.status === 404) {
      confirmedNotFound = true;
    } else if (response.ok) {
      const data: any = await response.json();
      if (data?.errors) {
        confirmedNotFound = true;
      } else if (typeof data.totalSolved === "number") {
        let avatarUrl = data.avatar;
        if (avatarUrl && avatarUrl.startsWith("/")) {
          avatarUrl = `https://leetcode.com${avatarUrl}`;
        }
        return {
          allTimeSolved: data.totalSolved || 0,
          easySolved: data.easySolved || 0,
          mediumSolved: data.normalSolved || data.mediumSolved || 0,
          hardSolved: data.hardSolved || 0,
          source: "Alfa API Proxy",
          avatarUrl: avatarUrl || undefined
        };
      }
    }
  } catch (err: any) {
    console.warn(`[Fetch] Alfa API Proxy failed: ${err.message}`);
  }

  // 3. leetcode-stats-api (fallback)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`https://leetcode-stats-api.herokuapp.com/${cleanUsername}`, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.status === 404) {
      confirmedNotFound = true;
    } else if (response.ok) {
      const data: any = await response.json();
      if (data?.status === "error") {
        confirmedNotFound = true;
      } else if (data?.status === "success") {
        return {
          allTimeSolved: data.totalSolved || 0,
          easySolved: data.easySolved || 0,
          mediumSolved: data.mediumSolved || 0,
          hardSolved: data.hardSolved || 0,
          source: "Stats API Proxy"
        };
      }
    }
  } catch (err: any) {
    console.warn(`[Fetch] Stats API Proxy failed: ${err.message}`);
  }

  // Every source either explicitly said "doesn't exist" or failed outright.
  // Report the truth instead of making up numbers.
  if (confirmedNotFound) {
    throw new LeetCodeUserNotFoundError(cleanUsername);
  }
  throw new LeetCodeUnavailableError(cleanUsername);
}

// Estimates problems solved in the trailing `days` days by diffing the
// current total against the closest history snapshot at or before that
// cutoff. Returns null when there isn't enough history yet to say —
// callers should treat null as "not enough data" rather than 0.
function computeProgressFromHistory(
  history: HistoryRecord[],
  currentTotal: number,
  days: number
): number | null {
  if (!history || history.length === 0) return null;

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));

  let baseline: HistoryRecord | null = null;
  for (const record of sorted) {
    if (new Date(record.date).getTime() <= cutoff) {
      baseline = record;
    } else {
      break;
    }
  }

  // No snapshot old enough yet — we haven't been tracking this user for
  // `days` days, so we can't honestly report a number for this window.
  if (!baseline) return null;

  return Math.max(0, currentTotal - baseline.solvedCount);
}

// REST API Endpoints

// GET all users (with automatic ranking update)
app.get("/api/users", async (req, res) => {
  try {
    const users = await listUsers();
    sortAndRankUsers(users);
    const lastSyncAll = (await getMeta("lastSyncAll")) || "";
    res.json({ users, lastSyncAll });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET — kicks off the 42 OAuth handshake. Sets a short-lived, httpOnly
// state cookie (CSRF protection for the redirect flow) and sends the
// browser to 42's authorize page.
app.get("/api/auth/42/login", authLimiter, (req, res) => {
  const state = crypto.randomBytes(24).toString("hex");
  res.cookie("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60 * 1000
  });
  res.redirect(buildAuthorizeUrl(state, getRedirectUri(req)));
});

// GET — 42 redirects back here after the person approves (or denies) the
// login. On success: if this 42 account is already linked to a cadet, log
// them straight in; otherwise issue a "pending" session (verified 42
// identity, no LeetCode username yet) and send them to finish enrollment.
app.get("/api/auth/42/callback", authLimiter, async (req, res) => {
  const { code, state } = req.query;
  const savedState = req.cookies?.oauth_state;
  res.clearCookie("oauth_state");

  if (
    !code ||
    typeof code !== "string" ||
    !state ||
    typeof state !== "string" ||
    !savedState ||
    state !== savedState
  ) {
    return res.redirect(
      `/?authError=${encodeURIComponent("42 login failed or expired — please try again.")}`
    );
  }

  try {
    const redirectUri = getRedirectUri(req);
    const accessToken = await exchangeCodeForToken(code, redirectUri);
    const profile = await fetchIntraProfile(accessToken);

    const existing = await getUserByIntraId(profile.intraId);
    if (existing) {
      setSessionCookie(res, { kind: "full", id: existing.id, leetcodeUsername: existing.leetcodeUsername });
      return res.redirect("/");
    }

    setSessionCookie(res, {
      kind: "pending",
      intraId: profile.intraId,
      intraDisplayName: profile.displayName,
      intraAvatarUrl: profile.avatarUrl
    });
    return res.redirect("/?enroll=1");
  } catch (error: any) {
    const message =
      error instanceof IntraAuthError
        ? error.message
        : "Couldn't complete 42 login. Please try again.";
    console.warn(`[42 OAuth] callback failed: ${error.message}`);
    return res.redirect(`/?authError=${encodeURIComponent(message)}`);
  }
});

// POST — finishes enrollment for someone who just signed in with 42.
// Requires a pending session; the only thing the client supplies is the
// LeetCode username (and an optional display name) — the 42 identity
// itself comes entirely from the verified session, never from the body.
app.post("/api/enroll", enrollLimiter, requirePendingAuth, async (req, res) => {
  const pending = (req as any).pending as PendingSession;
  const { leetcodeUsername, displayName } = req.body;

  if (!leetcodeUsername || typeof leetcodeUsername !== "string" || !leetcodeUsername.trim()) {
    return res.status(400).json({ error: "LeetCode username is required." });
  }

  try {
    const cleanLeetcodeUsername = leetcodeUsername.trim();
    const duplicate = await findDuplicate(cleanLeetcodeUsername, pending.intraId);
    if (duplicate) {
      return res
        .status(400)
        .json({ error: "A cadet with this LeetCode username or 42 account is already on the board." });
    }

    // Fetch real initial stats — throws if the username doesn't exist or
    // can't currently be verified.
    const scraped = await scrapeLeetCodeProfile(cleanLeetcodeUsername);
    const todayStr = new Date().toISOString().split("T")[0];

    const newUser: User = {
      id: `cadet-${Date.now()}`,
      displayName: (typeof displayName === "string" && displayName.trim()) || pending.intraDisplayName,
      leetcodeUsername: cleanLeetcodeUsername,
      intraId: pending.intraId,
      avatarUrl:
        scraped.avatarUrl ||
        pending.intraAvatarUrl ||
        `https://images.unsplash.com/photo-${Math.floor(Math.random() * 5000) + 1500000000}?auto=format&fit=crop&w=120&q=80`,
      allTimeSolved: scraped.allTimeSolved,
      easySolved: scraped.easySolved,
      mediumSolved: scraped.mediumSolved,
      hardSolved: scraped.hardSolved,
      // No history yet, so there's no honest way to report a weekly/monthly
      // delta — start at 0 rather than guessing.
      weeklyProgress: 0,
      monthlyProgress: 0,
      rank: 0,
      lastUpdated: new Date().toISOString(),
      history: [
        {
          date: todayStr,
          solvedCount: scraped.allTimeSolved,
          easy: scraped.easySolved,
          medium: scraped.mediumSolved,
          hard: scraped.hardSolved,
          weeklyProgress: 0
        }
      ]
    };

    await insertUser(newUser);

    // Promote the pending session to a full one now that enrollment is done.
    setSessionCookie(res, { kind: "full", id: newUser.id, leetcodeUsername: newUser.leetcodeUsername });

    res.status(201).json(newUser);
  } catch (error: any) {
    if (error instanceof LeetCodeUserNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof LeetCodeUnavailableError) {
      return res.status(503).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// POST logout
app.post("/api/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

// GET current auth state: "guest" (no session), "pending" (signed in with
// 42, hasn't picked a LeetCode username yet), or "authenticated" (fully
// enrolled cadet). The frontend uses this single endpoint to decide what
// to render instead of juggling several auth calls.
app.get("/api/auth/session", async (req, res) => {
  const session = readSession(req);
  if (!session) {
    return res.json({ status: "guest" });
  }

  if (session.kind === "pending") {
    return res.json({
      status: "pending",
      intra: {
        intraId: session.intraId,
        displayName: session.intraDisplayName,
        avatarUrl: session.intraAvatarUrl
      }
    });
  }

  const user = await getUserById(session.id);
  if (!user) {
    clearSessionCookie(res);
    return res.json({ status: "guest" });
  }
  res.json({ status: "authenticated", user });
});

// DELETE user — only the account owner can remove themselves
app.delete("/api/users/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const session = (req as any).user;

  if (session.id !== id) {
    return res.status(403).json({ error: "You can only remove your own account." });
  }

  try {
    const deleted = await deleteUserById(id);
    if (!deleted) {
      return res.status(404).json({ error: "User not found." });
    }
    clearSessionCookie(res);
    res.json({ success: true, message: "Cadet removed successfully." });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST refresh individual user
app.post("/api/users/:id/refresh", refreshLimiter, async (req, res) => {
  const { id } = req.params;

  try {
    const user = await getUserById(id);

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    let scraped;
    try {
      scraped = await scrapeLeetCodeProfile(user.leetcodeUsername);
    } catch (err: any) {
      // Keep the user's existing stats untouched — don't fabricate anything.
      if (err instanceof LeetCodeUserNotFoundError) {
        return res.status(404).json({ error: err.message, user });
      }
      return res.status(503).json({ error: err.message, user });
    }

    user.allTimeSolved = scraped.allTimeSolved;
    user.easySolved = scraped.easySolved;
    user.mediumSolved = scraped.mediumSolved;
    user.hardSolved = scraped.hardSolved;
    if (scraped.avatarUrl) {
      user.avatarUrl = scraped.avatarUrl;
    }

    // Derive weekly/monthly progress from our own history snapshots (taken
    // BEFORE we push today's record below), not from LeetCode's capped
    // recent-submissions endpoint.
    const weekly = computeProgressFromHistory(user.history, scraped.allTimeSolved, 7);
    const monthly = computeProgressFromHistory(user.history, scraped.allTimeSolved, 30);
    user.weeklyProgress = weekly ?? user.weeklyProgress;
    user.monthlyProgress = monthly ?? user.monthlyProgress;

    user.lastUpdated = new Date().toISOString();

    // Update historical logs
    const todayStr = new Date().toISOString().split("T")[0];
    const existingHistoryIndex = user.history.findIndex(h => h.date === todayStr);

    if (existingHistoryIndex !== -1) {
      user.history[existingHistoryIndex] = {
        date: todayStr,
        solvedCount: user.allTimeSolved,
        easy: user.easySolved,
        medium: user.mediumSolved,
        hard: user.hardSolved,
        weeklyProgress: user.weeklyProgress
      };
    } else {
      user.history.push({
        date: todayStr,
        solvedCount: user.allTimeSolved,
        easy: user.easySolved,
        medium: user.mediumSolved,
        hard: user.hardSolved,
        weeklyProgress: user.weeklyProgress
      });
      // Limit history to last 60 records to save space
      if (user.history.length > 60) {
        user.history.shift();
      }
    }

    await updateUser(user);

    res.json(user);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Refreshes every tracked user's real stats. Shared by the manual
// "Force Sync All" route and the periodic background job below — neither
// one invents numbers; both just call the same real fetch logic.
async function syncAllUsers(): Promise<{ users: User[]; lastSyncAll: string }> {
  const users = await listUsers();
  console.log(`[Sync All] Refreshing ${users.length} users.`);

  for (const user of users) {
    try {
      const scraped = await scrapeLeetCodeProfile(user.leetcodeUsername);

      user.allTimeSolved = scraped.allTimeSolved;
      user.easySolved = scraped.easySolved;
      user.mediumSolved = scraped.mediumSolved;
      user.hardSolved = scraped.hardSolved;
      if (scraped.avatarUrl) {
        user.avatarUrl = scraped.avatarUrl;
      }

      const weekly = computeProgressFromHistory(user.history, scraped.allTimeSolved, 7);
      const monthly = computeProgressFromHistory(user.history, scraped.allTimeSolved, 30);
      user.weeklyProgress = weekly ?? user.weeklyProgress;
      user.monthlyProgress = monthly ?? user.monthlyProgress;

      user.lastUpdated = new Date().toISOString();

      // Add to history
      const todayStr = new Date().toISOString().split("T")[0];
      const histIndex = user.history.findIndex(h => h.date === todayStr);
      if (histIndex !== -1) {
        user.history[histIndex] = {
          date: todayStr,
          solvedCount: user.allTimeSolved,
          easy: user.easySolved,
          medium: user.mediumSolved,
          hard: user.hardSolved,
          weeklyProgress: user.weeklyProgress
        };
      } else {
        user.history.push({
          date: todayStr,
          solvedCount: user.allTimeSolved,
          easy: user.easySolved,
          medium: user.mediumSolved,
          hard: user.hardSolved,
          weeklyProgress: user.weeklyProgress
        });
        if (user.history.length > 60) {
          user.history.shift();
        }
      }

      await updateUser(user);
    } catch (err: any) {
      // Leave this user's stats untouched for this cycle rather than
      // guessing — the next sync will pick them up again.
      console.warn(`[Sync All] Skipping ${user.leetcodeUsername}: ${err.message}`);
    }
  }

  const lastSyncAll = new Date().toISOString();
  await setMeta("lastSyncAll", lastSyncAll);
  sortAndRankUsers(users);
  return { users, lastSyncAll };
}

// POST refresh all users
app.post("/api/refresh-all", refreshLimiter, async (req, res) => {
  try {
    const result = await syncAllUsers();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET aggregated monthly trend metrics
app.get("/api/trends", async (req, res) => {
  try {
    const users = await listUsers();

    // Aggregate historical solve curves for the group
    // Gather all historical dates in sorted order
    const dateMap: { [date: string]: { date: string; solved: number; easy: number; medium: number; hard: number; activeUsers: number } } = {};

    users.forEach(u => {
      u.history.forEach(h => {
        if (!dateMap[h.date]) {
          dateMap[h.date] = {
            date: h.date,
            solved: 0,
            easy: 0,
            medium: 0,
            hard: 0,
            activeUsers: 0
          };
        }
        dateMap[h.date].solved += h.solvedCount;
        dateMap[h.date].easy += h.easy;
        dateMap[h.date].medium += h.medium;
        dateMap[h.date].hard += h.hard;
        dateMap[h.date].activeUsers += 1;
      });
    });

    const trendData = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));

    // Calculate dynamic difficulty totals
    let easyTotal = 0;
    let mediumTotal = 0;
    let hardTotal = 0;
    users.forEach(u => {
      easyTotal += u.easySolved;
      mediumTotal += u.mediumSolved;
      hardTotal += u.hardSolved;
    });

    // Top solver of the week
    let topSolver = "None";
    let topCount = 0;
    users.forEach(u => {
      if (u.weeklyProgress > topCount) {
        topCount = u.weeklyProgress;
        topSolver = u.displayName;
      }
    });

    res.json({
      historyTrend: trendData,
      difficultyBreakdown: [
        { name: "Easy", value: easyTotal, color: "#10b981" },
        { name: "Medium", value: mediumTotal, color: "#f59e0b" },
        { name: "Hard", value: hardTotal, color: "#ef4444" }
      ],
      topSolverThisWeek: topSolver,
      topSolverThisWeekCount: topCount,
      totalSolved: users.reduce((acc, u) => acc + u.allTimeSolved, 0)
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET — triggered by Vercel Cron on a schedule (see vercel.json) since a
// setInterval inside a serverless function instance doesn't reliably persist
// between invocations. When CRON_SECRET is set, only requests carrying it
// (as Vercel automatically does for its own cron invocations) are accepted,
// so this can't be used by anyone to force-trigger a sync.
app.get("/api/cron/sync", async (req, res) => {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized." });
    }
  }
  try {
    const result = await syncAllUsers();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Serve frontend assets in production and Vite dev server in development
async function startServer() {
  await dbReady;

  if (process.env.NODE_ENV !== "production") {
    // Dynamic import — kept out of the module's top-level static imports so
    // vite/rollup are never loaded at all on Vercel (this whole branch, and
    // even startServer() itself, never executes there). A static top-level
    // `import ... from "vite"` would run unconditionally on every cold
    // start regardless of this if-check, which was crashing every request.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Periodic background sync — only for traditional/persistent hosts. On
  // Vercel, VERCEL is set and this whole function isn't called at all;
  // /api/cron/sync + Vercel Cron (see vercel.json) does this job instead.
  setInterval(() => {
    syncAllUsers()
      .then(({ users }) => {
        console.log(`[Background Sync] Refreshed ${users.length} users.`);
      })
      .catch((e) => {
        console.warn(`[Background Sync] Failed: ${e.message}`);
      });
  }, 1000 * 60 * 30);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  // Traditional host (Render/Railway/Fly/local dev/etc): run the app the
  // normal way — bind a port, serve static files ourselves, run the
  // background sync interval.
  startServer();
}

// Vercel Functions call the exported handler directly per-request instead
// of using app.listen() — this is what actually makes the app reachable
// when deployed there. Harmless to export on other hosts too; nothing
// imports it there.
export default app;