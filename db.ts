import { createClient, type Client } from "@libsql/client";
import { User } from "./src/types.js";

// If TURSO_DATABASE_URL is set, connect to a real Turso cloud database.
// Otherwise fall back to a local SQLite file (no signup needed) so the
// project still runs out of the box — same @libsql/client API either way,
// so upgrading later is just setting two env vars, no code changes.
const url = process.env.TURSO_DATABASE_URL || "file:local.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

export const client: Client = authToken
  ? createClient({ url, authToken })
  : createClient({ url });

export async function initDb(): Promise<void> {
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        leetcode_username TEXT NOT NULL,
        intra_id TEXT NOT NULL,
        avatar_url TEXT,
        all_time_solved INTEGER NOT NULL DEFAULT 0,
        easy_solved INTEGER NOT NULL DEFAULT 0,
        medium_solved INTEGER NOT NULL DEFAULT 0,
        hard_solved INTEGER NOT NULL DEFAULT 0,
        weekly_progress INTEGER NOT NULL DEFAULT 0,
        monthly_progress INTEGER NOT NULL DEFAULT 0,
        last_updated TEXT NOT NULL,
        history TEXT NOT NULL DEFAULT '[]',
        password_hash TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_leetcode ON users(leetcode_username)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_intra ON users(intra_id)`,
      `CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )`
    ],
    "write"
  );

  // password_hash is a leftover from the old password-based signup flow.
  // Authentication is now entirely via 42 OAuth (see intra.ts/auth.ts), so
  // nothing writes to this column anymore — it's kept only so DBs created
  // before this change don't need a manual migration.
  try {
    await client.execute(`ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''`);
  } catch {
    // Column already exists — fine, ignore.
  }
}

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    displayName: row.display_name as string,
    leetcodeUsername: row.leetcode_username as string,
    intraId: row.intra_id as string,
    avatarUrl: (row.avatar_url as string) || "",
    allTimeSolved: Number(row.all_time_solved),
    easySolved: Number(row.easy_solved),
    mediumSolved: Number(row.medium_solved),
    hardSolved: Number(row.hard_solved),
    weeklyProgress: Number(row.weekly_progress),
    monthlyProgress: Number(row.monthly_progress),
    // Rank is derived at read time (see sortAndRankUsers in server.ts),
    // never stored — it depends on everyone else's stats, not just this row.
    rank: 0,
    lastUpdated: row.last_updated as string,
    history: JSON.parse((row.history as string) || "[]")
  };
}

export async function listUsers(): Promise<User[]> {
  const res = await client.execute("SELECT * FROM users");
  return res.rows.map((r) => rowToUser(r as unknown as Record<string, unknown>));
}

export async function getUserById(id: string): Promise<User | null> {
  const res = await client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
  return res.rows.length ? rowToUser(res.rows[0] as unknown as Record<string, unknown>) : null;
}

// Looks up a cadet by their 42 (Intra) login — this is how the OAuth
// callback decides whether someone who just signed in with 42 already has
// an account (log them in) or still needs to enroll (issue a pending
// session instead).
export async function getUserByIntraId(intraId: string): Promise<User | null> {
  const res = await client.execute({
    sql: "SELECT * FROM users WHERE lower(intra_id) = lower(?)",
    args: [intraId]
  });
  return res.rows.length ? rowToUser(res.rows[0] as unknown as Record<string, unknown>) : null;
}

export async function findDuplicate(leetcodeUsername: string, intraId: string): Promise<boolean> {
  const res = await client.execute({
    sql: "SELECT id FROM users WHERE lower(leetcode_username) = lower(?) OR lower(intra_id) = lower(?)",
    args: [leetcodeUsername, intraId]
  });
  return res.rows.length > 0;
}

export async function insertUser(user: User): Promise<void> {
  await client.execute({
    sql: `INSERT INTO users
      (id, display_name, leetcode_username, intra_id, avatar_url, all_time_solved,
       easy_solved, medium_solved, hard_solved, weekly_progress, monthly_progress,
       last_updated, history)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      user.id,
      user.displayName,
      user.leetcodeUsername,
      user.intraId,
      user.avatarUrl,
      user.allTimeSolved,
      user.easySolved,
      user.mediumSolved,
      user.hardSolved,
      user.weeklyProgress,
      user.monthlyProgress,
      user.lastUpdated,
      JSON.stringify(user.history)
    ]
  });
}

export async function updateUser(user: User): Promise<void> {
  await client.execute({
    sql: `UPDATE users SET
      display_name = ?, avatar_url = ?, all_time_solved = ?, easy_solved = ?,
      medium_solved = ?, hard_solved = ?, weekly_progress = ?, monthly_progress = ?,
      last_updated = ?, history = ?
      WHERE id = ?`,
    args: [
      user.displayName,
      user.avatarUrl,
      user.allTimeSolved,
      user.easySolved,
      user.mediumSolved,
      user.hardSolved,
      user.weeklyProgress,
      user.monthlyProgress,
      user.lastUpdated,
      JSON.stringify(user.history),
      user.id
    ]
  });
}

export async function deleteUserById(id: string): Promise<boolean> {
  const res = await client.execute({ sql: "DELETE FROM users WHERE id = ?", args: [id] });
  return (res.rowsAffected ?? 0) > 0;
}

export async function getMeta(key: string): Promise<string | null> {
  const res = await client.execute({ sql: "SELECT value FROM meta WHERE key = ?", args: [key] });
  return res.rows.length ? (res.rows[0].value as string) : null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await client.execute({
    sql: `INSERT INTO meta (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [key, value]
  });
}
