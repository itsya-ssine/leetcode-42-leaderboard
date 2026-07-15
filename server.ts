import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { createServer as createViteServer } from "vite";
import "dotenv/config";
import { User, HistoryRecord } from "./src/types.js";
import {
  initDb,
  listUsers,
  getUserById,
  findDuplicate,
  insertUser,
  updateUser,
  deleteUserById,
  getMeta,
  setMeta,
  getAuthByLeetcodeUsername
} from "./db.js";
import { hashPassword, verifyPassword, setSessionCookie, clearSessionCookie, readSession, requireAuth } from "./auth.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

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

// POST create user (signup)
app.post("/api/users", async (req, res) => {
  const { displayName, leetcodeUsername, intraId, password } = req.body;

  if (!leetcodeUsername || !intraId) {
    return res.status(400).json({ error: "LeetCode Username and Intra ID are required." });
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "A password of at least 8 characters is required." });
  }

  try {
    // Check if user already exists
    const duplicate = await findDuplicate(leetcodeUsername, intraId);
    if (duplicate) {
      return res.status(400).json({ error: "Cadet with this LeetCode or Intra ID already on the board." });
    }

    // Fetch real initial stats — throws if the username doesn't exist or
    // can't currently be verified.
    const scraped = await scrapeLeetCodeProfile(leetcodeUsername);
    const todayStr = new Date().toISOString().split("T")[0];

    const newUser: User = {
      id: `cadet-${Date.now()}`,
      displayName: displayName || leetcodeUsername,
      leetcodeUsername,
      intraId,
      avatarUrl: scraped.avatarUrl || `https://images.unsplash.com/photo-${Math.floor(Math.random() * 5000) + 1500000000}?auto=format&fit=crop&w=120&q=80`,
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

    const passwordHash = await hashPassword(password);
    await insertUser(newUser, passwordHash);

    // Log the newly-created account straight in, same as a normal login would.
    setSessionCookie(res, { id: newUser.id, leetcodeUsername: newUser.leetcodeUsername });

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

// POST login
app.post("/api/login", async (req, res) => {
  const { leetcodeUsername, password } = req.body;
  if (!leetcodeUsername || !password) {
    return res.status(400).json({ error: "LeetCode username and password are required." });
  }

  try {
    const record = await getAuthByLeetcodeUsername(leetcodeUsername);
    // Same generic error whether the username doesn't exist or the password
    // is wrong — don't let login responses reveal which usernames are registered.
    if (!record || !(await verifyPassword(password, record.passwordHash))) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    setSessionCookie(res, { id: record.user.id, leetcodeUsername: record.user.leetcodeUsername });
    res.json(record.user);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST logout
app.post("/api/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

// GET current logged-in user, if any
app.get("/api/me", async (req, res) => {
  const session = readSession(req);
  if (!session) {
    return res.status(401).json({ error: "Not logged in." });
  }
  const user = await getUserById(session.id);
  if (!user) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Not logged in." });
  }
  res.json(user);
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
app.post("/api/users/:id/refresh", async (req, res) => {
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
app.post("/api/refresh-all", async (req, res) => {
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

// Serve frontend assets in production and Vite dev server in development
async function startServer() {
  await initDb();

  if (process.env.NODE_ENV !== "production") {
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

  // Periodic background sync — refreshes everyone's REAL stats using the
  // same logic as "Force Sync All". Runs every 30 minutes rather than more
  // often, out of courtesy to the free public APIs this relies on.
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

startServer();
