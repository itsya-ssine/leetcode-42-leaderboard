import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { User } from "./types.js";

export interface IntraProfile {
  intraId: string;
  displayName: string;
  avatarUrl?: string;
}

export type SessionStatus = "loading" | "guest" | "pending" | "authenticated";

interface AuthContextValue {
  status: SessionStatus;
  user: User | null;
  // Populated only when status === "pending": the 42 identity that was
  // just verified, waiting on a LeetCode username to finish enrollment.
  pendingIntra: IntraProfile | null;
  // Authentication itself is a redirect to the server, which bounces the
  // browser to 42 and back — there's nothing to submit from the client.
  loginWithIntra: () => void;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  completeEnrollment: (leetcodeUsername: string, displayName?: string) => Promise<User>;
  // Lets an already-enrolled cadet repoint their board entry at a
  // different LeetCode account. Re-verified server-side before saving.
  updateLeetcodeUsername: (leetcodeUsername: string) => Promise<User>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [pendingIntra, setPendingIntra] = useState<IntraProfile | null>(null);

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session");
      const data = await res.json();
      if (data.status === "authenticated") {
        setUser(data.user);
        setPendingIntra(null);
        setStatus("authenticated");
      } else if (data.status === "pending") {
        setUser(null);
        setPendingIntra(data.intra);
        setStatus("pending");
      } else {
        setUser(null);
        setPendingIntra(null);
        setStatus("guest");
      }
    } catch {
      setUser(null);
      setPendingIntra(null);
      setStatus("guest");
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  // Authentication happens entirely on the server via 42's OAuth flow —
  // this just sends the browser there. The server sets a session cookie
  // and redirects back to "/" (or "/?enroll=1" for first-time cadets).
  const loginWithIntra = useCallback(() => {
    window.location.href = "/api/auth/42/login";
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/logout", { method: "POST" });
    setUser(null);
    setPendingIntra(null);
    setStatus("guest");
  }, []);

  const completeEnrollment = useCallback(async (leetcodeUsername: string, displayName?: string) => {
    const res = await fetch("/api/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leetcodeUsername, displayName })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Enrollment failed.");
    }
    setUser(data);
    setPendingIntra(null);
    setStatus("authenticated");
    return data as User;
  }, []);

  // Sends the new LeetCode username to the server, which re-verifies it
  // against LeetCode, re-links the row, and refreshes stats under the new
  // handle before responding with the updated cadet record.
  const updateLeetcodeUsername = useCallback(async (leetcodeUsername: string) => {
    if (!user) {
      throw new Error("You must be logged in to change your LeetCode username.");
    }
    const res = await fetch(`/api/users/${user.id}/leetcode-username`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leetcodeUsername })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to update LeetCode username.");
    }
    setUser(data);
    return data as User;
  }, [user]);

  return (
    <AuthContext.Provider
      value={{ status, user, pendingIntra, loginWithIntra, logout, refreshSession, completeEnrollment, updateLeetcodeUsername }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}