import type { User } from "./types.js";

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

// `longestStreak` is LeetCode's own streak data (see fetchStreaks in
// server.ts); null means it hasn't been fetched yet.
export function computeBadges(user: User): Badge[] {
  const longest = user.longestStreak ?? 0;

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
      description: `Submit on ${STREAK_BADGE_DAYS} days in a row on LeetCode`,
      earned: longest >= STREAK_BADGE_DAYS,
      progress: user.longestStreak == null ? "" : `${Math.min(longest, STREAK_BADGE_DAYS)}/${STREAK_BADGE_DAYS}`
    }
  ];
}