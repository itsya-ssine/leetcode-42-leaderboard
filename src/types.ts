export interface HistoryRecord {
  date: string; // ISO format YYYY-MM-DD
  solvedCount: number;
  easy: number;
  medium: number;
  hard: number;
  weeklyProgress: number; // problems solved in that week/relative to start
}

export interface User {
  id: string;
  displayName: string;
  leetcodeUsername: string;
  intraId: string;
  avatarUrl: string;
  allTimeSolved: number;
  easySolved: number;
  mediumSolved: number;
  hardSolved: number;
  weeklyProgress: number; // count solved in last 7 days
  monthlyProgress: number; // count solved in last 30 days
  rank: number;
  lastUpdated: string;
  history: HistoryRecord[];
  isPinned?: boolean;
}

export interface LeaderboardStats {
  totalSolved: number;
  avgSolved: number;
  activeUsers: number;
  topSolverThisWeek: string;
  topSolverThisWeekCount: number;
  weeklyVelocity: number;
}
