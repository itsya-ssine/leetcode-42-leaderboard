import React, { useState, useEffect } from "react";
import { 
  Award, 
  Search, 
  RefreshCw, 
  UserPlus, 
  Trash2, 
  Flame, 
  Check, 
  AlertTriangle, 
  Calendar, 
  Users, 
  BookOpen, 
  Code, 
  Layers,
  ArrowUpRight,
  Pin,
  TrendingUp,
  PieChart as PieChartIcon,
  X
} from "lucide-react";
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  BarChart, 
  Bar, 
  Cell, 
  PieChart, 
  Pie 
} from "recharts";
import { motion, AnimatePresence } from "motion/react";
import { User, HistoryRecord } from "./types.js";
import { useAuth } from "./AuthContext.js";
import LoginModal from "./LoginModal.js";

// Segmented Easy/Medium/Hard solve-count bar — green/amber/red proportional
// segments with the raw counts printed underneath in matching colors. Used
// both in the leaderboard row (compact) and the profile modal (roomier).
function DifficultyBar({
  easy,
  medium,
  hard,
  size = "sm"
}: {
  easy: number;
  medium: number;
  hard: number;
  size?: "sm" | "lg";
}) {
  const total = Math.max(1, easy + medium + hard);
  const easyPct = (easy / total) * 100;
  const mediumPct = (medium / total) * 100;
  const hardPct = (hard / total) * 100;
  const barHeight = size === "lg" ? "h-3" : "h-2";
  const textSize = size === "lg" ? "text-sm" : "text-[10px]";

  return (
    <div className="w-full flex flex-col gap-1.5">
      <div className={`w-full ${barHeight} rounded-full overflow-hidden flex bg-zinc-850`}>
        {easy > 0 && <div className="h-full bg-emerald-500" style={{ width: `${easyPct}%` }} title={`${easy} Easy`} />}
        {medium > 0 && <div className="h-full bg-amber-500" style={{ width: `${mediumPct}%` }} title={`${medium} Medium`} />}
        {hard > 0 && <div className="h-full bg-red-500" style={{ width: `${hardPct}%` }} title={`${hard} Hard`} />}
      </div>
      <div className={`flex items-center gap-1.5 ${textSize} font-mono font-bold`}>
        <span className="text-emerald-400">{easy}</span>
        <span className="text-zinc-700">/</span>
        <span className="text-amber-400">{medium}</span>
        <span className="text-zinc-700">/</span>
        <span className="text-red-400">{hard}</span>
      </div>
    </div>
  );
}

export default function App() {
  const { status: authStatus, user: currentUser, pendingIntra, logout, completeEnrollment } = useAuth();
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [lastSyncAll, setLastSyncAll] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"weekly" | "allTime">("allTime");
  const [loading, setLoading] = useState(true);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [pinnedUsers, setPinnedUsers] = useState<string[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Enroll (finish-signup) form state — the 42 identity itself comes from
  // pendingIntra above, verified server-side; the cadet only ever types
  // their LeetCode username here.
  const [leetcodeUsername, setLeetcodeUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [isEnrollOpen, setIsEnrollOpen] = useState(false);
  const [authBanner, setAuthBanner] = useState<string | null>(null);

  // Pick up ?enroll=1 / ?authError=... left by the 42 OAuth redirect, then
  // scrub them from the URL so refreshing the page doesn't replay them.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("authError");
    const enroll = params.get("enroll");
    if (authError) {
      setAuthBanner(authError);
    }
    if (authError || enroll) {
      params.delete("authError");
      params.delete("enroll");
      const rest = params.toString();
      window.history.replaceState({}, "", rest ? `?${rest}` : window.location.pathname);
    }
  }, []);

  // Once the server confirms we're in the "signed in with 42, not enrolled
  // yet" state, pop the enroll modal open automatically.
  useEffect(() => {
    if (authStatus === "pending") {
      setFormError(null);
      setFormSuccess(null);
      setIsEnrollOpen(true);
    }
  }, [authStatus]);

  // Trend analysis state
  const [trendData, setTrendData] = useState<any>(null);

  // Fetch users and metrics
  const loadData = async () => {
    try {
      const usersRes = await fetch("/api/users");
      const usersData = await usersRes.json();
      setUsers(usersData.users || []);
      setLastSyncAll(usersData.lastSyncAll || "");

      const trendsRes = await fetch("/api/trends");
      const trendsData = await trendsRes.json();
      setTrendData(trendsData);
    } catch (err) {
      console.error("Error loading data from server:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // Poll for updates so everyone sees new stats without a manual reload —
    // the server also runs a real background sync every 30 minutes.
    const interval = setInterval(() => {
      loadData();
    }, 15000); // poll every 15s so multiple viewers stay in sync
    return () => clearInterval(interval);
  }, []);

  // Handle cadet onboarding — the 42 identity is already verified (this
  // form only ever renders once authStatus === "pending"), so all we send
  // is the LeetCode username.
  const handleAddCadet = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!leetcodeUsername.trim()) {
      setFormError("LeetCode Username is required.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await completeEnrollment(leetcodeUsername.trim(), displayName.trim());
      setFormSuccess(`Cadet @${result.displayName} enrolled — fetched ${result.allTimeSolved} solved problems from LeetCode.`);
      setLeetcodeUsername("");
      setDisplayName("");
      await loadData();
      // pendingIntra is now cleared (enrollment is done), so leaving the
      // modal open would otherwise fall back into the "sign in with 42
      // first" empty state. Give the person a moment to read the success
      // message, then close it.
      setTimeout(() => {
        setIsEnrollOpen(false);
        setFormSuccess(null);
      }, 1800);
    } catch (err: any) {
      setFormError(err.message || "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle batch refresh / sync — admin only (button is hidden for
  // everyone else, and the server enforces this too).
  const handleSyncAll = async () => {
    setIsSyncingAll(true);
    try {
      const res = await fetch("/api/refresh-all", { method: "POST" });
      if (!res.ok) {
        throw new Error("Failed to sync entire roster.");
      }
      await loadData();
    } catch (err) {
      alert("Failed to batch update. Try again later.");
    } finally {
      setIsSyncingAll(false);
    }
  };

  // Handle remove user
  const handleRemoveUser = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to remove Cadet ${name} from the board?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error("Error removing cadet:", err);
    }
  };

  // Toggle pinned/compare users
  const togglePinUser = (id: string) => {
    if (pinnedUsers.includes(id)) {
      setPinnedUsers(pinnedUsers.filter(userId => userId !== id));
    } else {
      setPinnedUsers([...pinnedUsers, id]);
    }
  };

  // Filter and sort user list
  const filteredUsers = users.filter(u => {
    const q = searchQuery.toLowerCase();
    return (
      u.displayName.toLowerCase().includes(q) ||
      u.leetcodeUsername.toLowerCase().includes(q) ||
      u.intraId.toLowerCase().includes(q)
    );
  });

  // Calculate dynamic absolute ranks based on selected sortBy criteria (independent of pinning or search filtering)
  const rankedUsers = [...users].sort((a, b) => {
    if (sortBy === "weekly") {
      if (b.weeklyProgress !== a.weeklyProgress) {
        return b.weeklyProgress - a.weeklyProgress;
      }
      return b.allTimeSolved - a.allTimeSolved;
    } else {
      if (b.allTimeSolved !== a.allTimeSolved) {
        return b.allTimeSolved - a.allTimeSolved;
      }
      return b.weeklyProgress - a.weeklyProgress;
    }
  });

  // Map user ID to their dynamic absolute rank
  const userRanks: Record<string, number> = {};
  rankedUsers.forEach((user, index) => {
    userRanks[user.id] = index + 1;
  });

  const sortedUsers = [...filteredUsers].sort((a, b) => {
    // Pinned users always stay on top
    const aPinned = pinnedUsers.includes(a.id);
    const bPinned = pinnedUsers.includes(b.id);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;

    if (sortBy === "weekly") {
      if (b.weeklyProgress !== a.weeklyProgress) {
        return b.weeklyProgress - a.weeklyProgress;
      }
      return b.allTimeSolved - a.allTimeSolved;
    } else {
      if (b.allTimeSolved !== a.allTimeSolved) {
        return b.allTimeSolved - a.allTimeSolved;
      }
      return b.weeklyProgress - a.weeklyProgress;
    }
  });

  // Derived stats card values
  const totalSolvedAggregate = users.reduce((acc, u) => acc + u.allTimeSolved, 0);
  const averageSolved = users.length > 0 ? Math.round(totalSolvedAggregate / users.length) : 0;
  const topSolverWeekly = trendData?.topSolverThisWeek || "N/A";
  const topSolverWeeklyCount = trendData?.topSolverThisWeekCount || 0;
  const groupWeeklyVelocity = users.reduce((acc, u) => acc + u.weeklyProgress, 0);

  // Formatting Last Sync time
  const formatSyncTime = (isoString: string) => {
    if (!isoString) return "N/A";
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    } catch {
      return "14:02:44";
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans p-4 md:p-8 selection:bg-teal-500 selection:text-black">
      
      {/* Container holding elements beautifully aligned as specified by the "Bold Typography" design theme */}
      <div className="max-w-7xl mx-auto flex flex-col">
        
        {/* Header Section */}
        <header className="flex flex-col lg:flex-row justify-between items-start lg:items-end mb-10 border-b border-zinc-800 pb-6 gap-6">
          <div>
            <h1 className="text-6xl md:text-8xl font-black tracking-tighter leading-none italic uppercase text-white">
              Leader<span className="text-teal-500">42</span>
            </h1>
            <p className="mt-2 text-zinc-500 font-mono text-xs md:text-sm tracking-widest uppercase">
              Weekly LeetCode Sprint
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row lg:text-right items-start sm:items-center lg:items-end justify-between lg:justify-end gap-4 w-full lg:w-auto">
            
            {/* Last sync info */}
            <div>
              <div className="text-zinc-500 text-[10px] font-mono uppercase tracking-widest">Last Sync</div>
              <div className="text-3xl font-black font-mono text-white tracking-tight">
                {formatSyncTime(lastSyncAll)}
              </div>
              <div className="text-[10px] text-teal-400 font-bold uppercase tracking-tighter flex items-center lg:justify-end mt-1">
                <span className="w-2 h-2 bg-teal-400 rounded-full mr-2 animate-pulse"></span> 
                Scraping Engine Active
              </div>
            </div>

            {/* Force Sync All Trigger button with bold accent styling — admin only */}
            {currentUser?.isAdmin && (
              <button
                onClick={handleSyncAll}
                disabled={isSyncingAll || loading}
                className="flex items-center gap-2 bg-zinc-900 hover:bg-zinc-850 text-zinc-300 hover:text-white px-5 py-3 border border-zinc-800 hover:border-zinc-700 transition duration-200 text-xs font-mono font-bold uppercase tracking-widest disabled:opacity-50 cursor-pointer rounded-sm"
                id="sync-all-btn"
              >
                <RefreshCw className={`w-4 h-4 text-teal-400 ${isSyncingAll ? "animate-spin" : ""}`} />
                {isSyncingAll ? "Syncing..." : "Force Sync All"}
              </button>
            )}

            {/* Auth control */}
            {authStatus === "authenticated" && currentUser ? (
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-zinc-400">
                  Logged in as <span className="text-teal-400 font-bold">@{currentUser.leetcodeUsername}</span>
                </span>
                <button
                  onClick={() => logout()}
                  className="flex items-center gap-2 bg-zinc-900 hover:bg-zinc-850 text-zinc-300 hover:text-white px-4 py-3 border border-zinc-800 hover:border-zinc-700 transition duration-200 text-xs font-mono font-bold uppercase tracking-widest cursor-pointer rounded-sm"
                >
                  Log Out
                </button>
              </div>
            ) : authStatus === "pending" && pendingIntra ? (
              <button
                onClick={() => {
                  setFormError(null);
                  setFormSuccess(null);
                  setIsEnrollOpen(true);
                }}
                className="flex items-center gap-2 bg-teal-500 hover:bg-teal-400 text-black px-5 py-3 border border-transparent transition duration-200 text-xs font-mono font-black uppercase tracking-widest cursor-pointer rounded-sm"
                id="open-enroll-btn"
              >
                <UserPlus className="w-4 h-4 text-black" />
                Finish Enrollment (@{pendingIntra.intraId})
              </button>
            ) : (
              <button
                onClick={() => setIsLoginOpen(true)}
                className="flex items-center gap-2 bg-teal-500 hover:bg-teal-400 text-black px-5 py-3 border border-transparent transition duration-200 text-xs font-mono font-black uppercase tracking-widest cursor-pointer rounded-sm"
                id="open-enroll-btn"
              >
                <UserPlus className="w-4 h-4 text-black" />
                Log In With 42
              </button>
            )}

          </div>
        </header>

        {/* 42 OAuth error banner (e.g. denied / expired login attempt) */}
        {authBanner && (
          <div className="bg-red-950/20 text-red-400 text-xs p-3 rounded-sm border border-red-500/20 flex items-start gap-2 mb-6">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{authBanner}</span>
            <button
              onClick={() => setAuthBanner(null)}
              className="ml-auto text-red-400/70 hover:text-red-300 cursor-pointer"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* High-Level Roster Stats Banner */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10" id="stats-banner">
          
          <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-sm relative overflow-hidden group hover:border-zinc-700 transition-all">
            <div className="flex items-center gap-3 text-zinc-500 mb-3 text-xs uppercase font-bold tracking-widest font-mono">
              <Users className="w-4 h-4 text-teal-500" />
              <span>Cadets Tracked</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black text-white font-mono">{users.length}</span>
              <span className="text-xs text-zinc-500 font-mono">Total Enrolled</span>
            </div>
          </div>

          <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-sm relative overflow-hidden group hover:border-zinc-700 transition-all">
            <div className="flex items-center gap-3 text-zinc-500 mb-3 text-xs uppercase font-bold tracking-widest font-mono">
              <BookOpen className="w-4 h-4 text-teal-500" />
              <span>Code Volume</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black text-white font-mono">{totalSolvedAggregate}</span>
              <span className="text-xs text-zinc-500 font-mono">Problems Solved</span>
            </div>
          </div>

          <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-sm relative overflow-hidden group hover:border-zinc-700 transition-all">
            <div className="flex items-center gap-3 text-zinc-500 mb-3 text-xs uppercase font-bold tracking-widest font-mono">
              <Flame className="w-4 h-4 text-yellow-500" />
              <span>Solve Speed</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black text-teal-500 font-mono">+{groupWeeklyVelocity}</span>
              <span className="text-xs text-zinc-500 font-mono">Solved this week</span>
            </div>
          </div>

          <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-sm relative overflow-hidden group hover:border-zinc-700 transition-all">
            <div className="flex items-center gap-3 text-zinc-500 mb-3 text-xs uppercase font-bold tracking-widest font-mono">
              <Award className="w-4 h-4 text-teal-500" />
              <span>Weekly MVP</span>
            </div>
            <div className="truncate">
              <span className="text-lg font-black text-white uppercase italic block truncate">{topSolverWeekly}</span>
              <span className="text-xs text-zinc-500 font-mono">+{topSolverWeeklyCount} Solved problems</span>
            </div>
          </div>

        </section>

        {loading ? (
          <div className="flex flex-col justify-center items-center py-24 gap-4">
            <RefreshCw className="w-8 h-8 text-teal-500 animate-spin" />
            <p className="text-zinc-500 text-sm font-mono tracking-wider uppercase">Scanning 42 Intra profiles & parsing LeetCode statistics...</p>
          </div>
        ) : (
          <div className="w-full">
            
            {/* FULL-WIDTH COLUMN: Leaderboard list of cadets */}
            <section className="w-full flex flex-col gap-6" id="leaderboard-panel">
              
              {/* Filter controls & Search */}
              <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 bg-zinc-900 p-4 border border-zinc-800 rounded-sm">
                
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input 
                    type="text"
                    placeholder="Search cadet, LeetCode or Intra ID..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-zinc-950 text-zinc-100 placeholder-zinc-700 text-xs font-mono uppercase tracking-widest pl-10 pr-4 py-2.5 rounded-sm border border-zinc-800 focus:border-teal-500 focus:outline-none transition-all"
                    id="leaderboard-search"
                  />
                </div>

                {/* Sort selector matching bold typographic style */}
                <div className="flex bg-zinc-950 border border-zinc-800 p-1 rounded-sm">
                  <button
                    onClick={() => setSortBy("weekly")}
                    className={`px-4 py-1.5 rounded-sm text-[10px] font-mono uppercase tracking-wider transition-all cursor-pointer ${sortBy === "weekly" ? "bg-teal-500 text-black font-black" : "text-zinc-500 hover:text-zinc-300"}`}
                    id="sort-weekly-btn"
                  >
                    Weekly Growth
                  </button>
                  <button
                    onClick={() => setSortBy("allTime")}
                    className={`px-4 py-1.5 rounded-sm text-[10px] font-mono uppercase tracking-wider transition-all cursor-pointer ${sortBy === "allTime" ? "bg-teal-500 text-black font-black" : "text-zinc-500 hover:text-zinc-300"}`}
                    id="sort-alltime-btn"
                  >
                    All-Time Master
                  </button>
                </div>

              </div>

              {/* Table Column Labels */}
              <div className="grid grid-cols-12 px-4 text-[10px] uppercase font-bold tracking-widest text-zinc-500">
                <div className="col-span-1">Rank</div>
                <div className="col-span-4">Cadet</div>
                <div className="col-span-5">
                  {sortBy === "weekly" ? "Weekly Progress" : "Problems Solved — Easy / Medium / Hard"}
                </div>
                <div className="col-span-2 text-right">Total</div>
              </div>

              {/* Dynamic list of cadet rows */}
              <div className="flex flex-col gap-2">
                <AnimatePresence mode="popLayout">
                  {sortedUsers.length === 0 ? (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-center py-16 border border-dashed border-zinc-800 rounded-sm"
                    >
                      <AlertTriangle className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                      <p className="text-zinc-500 text-xs font-mono tracking-widest uppercase">No matching cadets found on the board.</p>
                    </motion.div>
                  ) : (
                    sortedUsers.map((user, index) => {
                      const isPinned = pinnedUsers.includes(user.id);
                      const actualRank = userRanks[user.id] || user.rank;
                      
                      // Format rank index (01, 02, etc.)
                      const formattedRank = String(actualRank).padStart(2, "0");
                      
                      // Highlight top ranks using bold typography guidelines
                      let rankStyle = "text-zinc-600";
                      if (actualRank === 1) {
                        rankStyle = "text-teal-500 font-black";
                      } else if (actualRank === 2) {
                        rankStyle = "text-zinc-400 font-bold";
                      } else if (actualRank === 3) {
                        rankStyle = "text-zinc-500 font-bold";
                      }

                      // Calculate percentage width for cadet progress bar relative to max 30 problems/week
                      const progressPercentage = Math.min(100, Math.round((user.weeklyProgress / 25) * 100));

                      return (
                        <motion.div
                          key={user.id}
                          layoutId={user.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className={`grid grid-cols-12 items-center p-4 rounded-sm border transition-all duration-200 ${isPinned ? "bg-zinc-900 border-teal-500/80" : "bg-zinc-900/30 hover:bg-zinc-900/60 border-zinc-850"}`}
                          id={`cadet-row-${user.id}`}
                        >
                          {/* Rank indicator */}
                          <div className={`col-span-1 text-3xl font-black italic tracking-tighter ${rankStyle}`}>
                            {formattedRank}
                          </div>

                          {/* Cadet Profile — click to open the full profile card */}
                          <div
                            className="col-span-4 flex items-center gap-3 cursor-pointer group/cadet"
                            onClick={() => setSelectedUser(user)}
                            title="View full profile"
                          >
                            <img 
                              src={user.avatarUrl} 
                              alt={user.displayName}
                              className="w-10 h-10 rounded-full object-cover border border-zinc-800 group-hover/cadet:border-teal-500/60 transition-colors"
                              referrerPolicy="no-referrer"
                            />
                            <div className="truncate pr-2">
                              <div className="flex items-center gap-1.5">
                                <span className="font-black text-white text-base tracking-tight truncate group-hover/cadet:text-teal-400 transition-colors">
                                  {user.displayName}
                                </span>
                                {user.weeklyProgress >= 12 && (
                                  <Flame className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500/10 shrink-0" title="Hot Solve Streak!" />
                                )}
                              </div>
                              <span className="text-[10px] text-zinc-600 italic block font-mono group-hover/cadet:text-teal-500/70 transition-colors">
                                View Profile
                              </span>
                            </div>
                          </div>

                          {/* Progress column — weekly bar when sorted by Weekly Growth,
                              Easy/Medium/Hard breakdown bar when sorted by All-Time Master */}
                          <div className="col-span-5 flex items-center pr-6">
                            {sortBy === "weekly" ? (
                              <div className="w-full flex items-center gap-3">
                                <div className="w-full bg-zinc-850 h-2 rounded-full overflow-hidden">
                                  <div 
                                    className="bg-teal-500 h-full transition-all duration-300" 
                                    style={{ width: `${progressPercentage}%` }}
                                  />
                                </div>
                                <span className="text-xs font-mono font-bold text-zinc-300 shrink-0">
                                  +{user.weeklyProgress}
                                </span>
                              </div>
                            ) : (
                              <DifficultyBar easy={user.easySolved} medium={user.mediumSolved} hard={user.hardSolved} size="sm" />
                            )}
                          </div>

                          {/* Total Solved & Controls */}
                          <div className="col-span-2 text-right flex items-center justify-end gap-3">
                            <div className="font-mono text-xl font-bold text-white pr-1">
                              {user.allTimeSolved}
                            </div>

                            <div className="flex items-center gap-1">
                              {/* Pin Compare toggle */}
                              <button 
                                onClick={(e) => { e.stopPropagation(); togglePinUser(user.id); }}
                                className={`p-1 rounded-sm hover:bg-zinc-850 transition-colors ${isPinned ? "text-teal-400" : "text-zinc-600 hover:text-zinc-400"}`}
                                title={isPinned ? "Unpin Cadet" : "Pin Cadet to Compare"}
                              >
                                <Pin className="w-3 h-3 fill-current" />
                              </button>
                              
                              {/* Remove button — admin only, can remove any cadet */}
                              {currentUser?.isAdmin && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleRemoveUser(user.id, user.displayName); }}
                                  className="p-1 rounded-sm hover:bg-red-950/30 text-zinc-600 hover:text-red-400 transition-colors"
                                  title="Remove Cadet"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>

                        </motion.div>
                      );
                    })
                  )}
                </AnimatePresence>
              </div>

              {/* Info footer */}
              <div className="flex items-center justify-between text-[10px] text-zinc-600 font-mono uppercase tracking-widest pt-4 border-t border-zinc-900 mt-4">
                <span>Total Roster Size // {users.length} enrolled cadets</span>
                <span>Sorted by Weekly Momentum to prioritize active coding sprints</span>
              </div>

            </section>

          </div>
        )}

        <LoginModal open={isLoginOpen} onClose={() => setIsLoginOpen(false)} />

        {/* Cadet Profile Modal — opens when a leaderboard row is clicked */}
        <AnimatePresence>
          {selectedUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSelectedUser(null)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />

              {/* Modal Box */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                transition={{ type: "spring", duration: 0.4, bounce: 0.15 }}
                className="bg-zinc-900 border border-zinc-800 p-6 rounded-sm w-full max-w-md relative z-10 shadow-2xl max-h-[90vh] overflow-y-auto"
                id="profile-modal"
              >
                <button
                  onClick={() => setSelectedUser(null)}
                  className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-850 p-1.5 rounded-sm transition-colors cursor-pointer"
                  aria-label="Close modal"
                >
                  <X className="w-4 h-4" />
                </button>

                {/* Identity header */}
                <div className="flex items-center gap-4 mb-6 pr-8">
                  <img
                    src={selectedUser.avatarUrl}
                    alt={selectedUser.displayName}
                    className="w-16 h-16 rounded-sm object-cover border-2 border-teal-500/40"
                    referrerPolicy="no-referrer"
                  />
                  <div className="truncate">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-black text-white tracking-tight truncate">{selectedUser.displayName}</h3>
                      {selectedUser.weeklyProgress >= 12 && (
                        <Flame className="w-4 h-4 text-yellow-500 fill-yellow-500/10 shrink-0" title="Hot Solve Streak!" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-teal-400 text-[10px] font-mono font-bold uppercase tracking-widest mt-1">
                      <Award className="w-3 h-3" />
                      Rank #{String(userRanks[selectedUser.id] || selectedUser.rank).padStart(2, "0")}
                    </div>
                  </div>
                </div>

                {/* Profile links */}
                <div className="flex items-center gap-2 mb-6">
                  <a
                    href={`https://profile.intra.42.fr/users/${selectedUser.intraId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 bg-zinc-950 hover:bg-zinc-850 border border-zinc-800 hover:border-zinc-700 text-xs font-bold rounded-sm uppercase tracking-wider text-zinc-200 transition-colors"
                  >
                    <span>42 // {selectedUser.intraId}</span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-teal-400" />
                  </a>
                  <a
                    href={`https://leetcode.com/${selectedUser.leetcodeUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 bg-zinc-950 hover:bg-zinc-850 border border-zinc-800 hover:border-zinc-700 text-xs font-bold rounded-sm uppercase tracking-wider text-zinc-200 transition-colors"
                  >
                    <span>Leet // {selectedUser.leetcodeUsername}</span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-yellow-500" />
                  </a>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-3 gap-2 mb-6">
                  <div className="bg-zinc-950 border border-zinc-800 rounded-sm p-3 text-center">
                    <div className="text-2xl font-black text-white font-mono">{selectedUser.allTimeSolved}</div>
                    <div className="text-[9px] text-zinc-500 uppercase font-bold tracking-widest mt-1">All-Time</div>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-sm p-3 text-center">
                    <div className="text-2xl font-black text-teal-400 font-mono">+{selectedUser.weeklyProgress}</div>
                    <div className="text-[9px] text-zinc-500 uppercase font-bold tracking-widest mt-1">This Week</div>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-sm p-3 text-center">
                    <div className="text-2xl font-black text-zinc-300 font-mono flex items-center justify-center gap-1">
                      <TrendingUp className="w-4 h-4 text-zinc-500" />
                      {selectedUser.monthlyProgress}
                    </div>
                    <div className="text-[9px] text-zinc-500 uppercase font-bold tracking-widest mt-1">This Month</div>
                  </div>
                </div>

                {/* Difficulty breakdown */}
                <div className="bg-zinc-950 border border-zinc-800 rounded-sm p-4 mb-6">
                  <div className="flex items-center gap-2 text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-3">
                    <Layers className="w-3.5 h-3.5 text-teal-500" />
                    Difficulty Breakdown
                  </div>
                  <DifficultyBar
                    easy={selectedUser.easySolved}
                    medium={selectedUser.mediumSolved}
                    hard={selectedUser.hardSolved}
                    size="lg"
                  />
                </div>

                {/* Extra info */}
                <div className="flex items-center justify-between text-[10px] text-zinc-600 font-mono uppercase tracking-widest pt-4 border-t border-zinc-900">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3 h-3" />
                    Last Synced
                  </span>
                  <span className="text-zinc-400">
                    {selectedUser.lastUpdated ? new Date(selectedUser.lastUpdated).toLocaleString() : "N/A"}
                  </span>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Enroll Cadet Modal Popup */}
        <AnimatePresence>
          {isEnrollOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsEnrollOpen(false)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />

              {/* Modal Box */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                transition={{ type: "spring", duration: 0.4, bounce: 0.15 }}
                className="bg-zinc-900 border border-zinc-800 p-6 rounded-sm w-full max-w-md relative z-10 shadow-2xl"
                id="enroll-modal"
              >
                <button
                  onClick={() => setIsEnrollOpen(false)}
                  className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-850 p-1.5 rounded-sm transition-colors cursor-pointer"
                  aria-label="Close modal"
                >
                  <X className="w-4 h-4" />
                </button>

                <h3 className="text-sm font-mono uppercase tracking-[0.2em] text-zinc-300 mb-2 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-teal-400" />
                  Finish Enrollment
                </h3>

                {pendingIntra ? (
                  <div className="flex items-center gap-3 mb-6 bg-zinc-950 border border-zinc-800 rounded-sm p-3">
                    {pendingIntra.avatarUrl && (
                      <img
                        src={pendingIntra.avatarUrl}
                        alt={pendingIntra.displayName}
                        className="w-9 h-9 rounded-sm object-cover border border-zinc-800"
                      />
                    )}
                    <div>
                      <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider font-mono">Verified via 42</div>
                      <div className="text-xs text-teal-400 font-mono font-bold">@{pendingIntra.intraId}</div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 mb-6">
                    Sign in with 42 first — your Intra identity is confirmed by 42 itself, not typed in here.
                  </p>
                )}

                <form onSubmit={handleAddCadet} className="flex flex-col gap-4">
                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-1 uppercase font-bold tracking-wider font-mono">LeetCode Username</label>
                    <input 
                      type="text"
                      placeholder="e.g. jsmith"
                      value={leetcodeUsername}
                      onChange={(e) => setLeetcodeUsername(e.target.value)}
                      className="w-full bg-zinc-950 text-zinc-100 placeholder-zinc-700 text-xs font-mono uppercase tracking-widest px-3 py-2.5 rounded-sm border border-zinc-800 focus:border-teal-500 focus:outline-none transition-all"
                      required
                      disabled={!pendingIntra}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-1 uppercase font-bold tracking-wider font-mono">Display Name (Optional)</label>
                    <input 
                      type="text"
                      placeholder="e.g. CodeSlayer"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full bg-zinc-950 text-zinc-100 placeholder-zinc-700 text-xs font-mono uppercase tracking-widest px-3 py-2.5 rounded-sm border border-zinc-800 focus:border-teal-500 focus:outline-none transition-all"
                      disabled={!pendingIntra}
                    />
                  </div>

                  {!pendingIntra && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsEnrollOpen(false);
                        setIsLoginOpen(true);
                      }}
                      className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-black uppercase tracking-widest text-xs py-3 rounded-sm transition duration-200 cursor-pointer"
                    >
                      Sign In With 42 First
                    </button>
                  )}

                  {formError && (
                    <div className="bg-red-950/20 text-red-400 text-xs p-3 rounded-sm border border-red-500/20 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{formError}</span>
                    </div>
                  )}

                  {formSuccess && (
                    <div className="bg-teal-950/20 text-teal-400 text-xs p-3 rounded-sm border border-teal-500/20 flex items-start gap-2">
                      <Check className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{formSuccess}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting || !pendingIntra}
                    className="w-full bg-teal-500 hover:bg-teal-400 text-black font-black uppercase tracking-widest text-xs py-3 rounded-sm transition duration-200 shadow-md flex items-center justify-center gap-2 cursor-pointer mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin text-black" />
                        Scraping...
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4 text-black" />
                        Enroll & Scrape Profile
                      </>
                    )}
                  </button>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Footer Section */}
        <footer className="mt-16 border-t border-zinc-800 pt-8 flex flex-col md:flex-row justify-between items-center text-zinc-500 font-mono text-[10px] uppercase tracking-widest gap-4">
          <div>Internal Use Only • 42 School Management System</div>
          <div className="flex space-x-6">
            <span className="text-zinc-400">Documentation</span>
            <span className="text-zinc-400">API Status</span>
            <span className="text-white font-bold">v2.4.0-stable</span>
          </div>
        </footer>

      </div>
    </div>
  );
}