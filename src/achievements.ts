import type { HistoryRecord, User } from "./types.js";

const DAY_MS = 86_400_000;

// History dates are UTC calendar days: the server writes them with
// toISOString().split("T")[0], so all day maths here is UTC too.
const dayIndex = (isoDate: string) => Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS);

/* ---------- Streaks ---------- */

// A day is "active" when its snapshot shows a higher solved count than the
// snapshot right before it. If the previous snapshot is several days back
// (the server was down, or the cadet enrolled mid-gap) the increase can't be
// attributed to a specific day, so only the snapshot's own day is credited.
// That errs on the side of a shorter streak rather than inventing activity.
function activeDayIndexes(history: HistoryRecord[]): number[] {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const days: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].solvedCount > sorted[i - 1].solvedCount) {
      days.push(dayIndex(sorted[i].date));
    }
  }
  return days;
}

export interface Streaks {
  current: number;
  longest: number;
}

// `current` stays alive through today even if nothing has been solved yet
// today, so a streak only drops to 0 once a whole day has passed without a
// solve. `longest` can only look back as far as the stored history (the
// server keeps the last 60 snapshots).
export function computeStreaks(history: HistoryRecord[], now: number = Date.now()): Streaks {
  const days = activeDayIndexes(history || []);

  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of days) {
    run = prev !== null && d === prev + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }

  const today = Math.floor(now / DAY_MS);
  const current = prev !== null && prev >= today - 1 ? run : 0;
  return { current, longest };
}

/* ---------- Badges ---------- */

export interface Badge {
  id: string;
  label: string;
  description: string;
  earned: boolean;
  // Short "42/100"-style hint for locked badges; empty for one-off badges.
  progress: string;
}

const SOLVED_MILESTONES = [100, 500, 1000] as const;
const STREAK_BADGE_DAYS = 7;

export function computeBadges(user: User, longestStreak: number): Badge[] {
  const solvedBadges: Badge[] = SOLVED_MILESTONES.map((target) => ({
    id: `solved-${target}`,
    label: `${target.toLocaleString()} solved`,
    description: `Solve ${target.toLocaleString()} problems`,
    earned: user.allTimeSolved >= target,
    progress: `${Math.min(user.allTimeSolved, target)}/${target}`
  }));

  return [
    ...solvedBadges,
    {
      id: "first-hard",
      label: "First Hard",
      description: "Solve your first Hard problem",
      earned: user.hardSolved >= 1,
      progress: ""
    },
    {
      id: "first-contest",
      label: "First contest",
      description: "Take part in a LeetCode contest",
      earned: user.contestsAttended >= 1 || user.contestRating != null,
      progress: ""
    },
    {
      id: "streak-7",
      label: "7-day streak",
      description: `Solve at least one problem a day for ${STREAK_BADGE_DAYS} days in a row`,
      earned: longestStreak >= STREAK_BADGE_DAYS,
      progress: `${Math.min(longestStreak, STREAK_BADGE_DAYS)}/${STREAK_BADGE_DAYS}`
    }
  ];
}