import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { LogIn, X, AlertTriangle } from "lucide-react";
import { useAuth } from "./AuthContext.js";

export default function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { login } = useAuth();
  const [leetcodeUsername, setLeetcodeUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(leetcodeUsername.trim(), password);
      setLeetcodeUsername("");
      setPassword("");
      onClose();
    } catch (err: any) {
      setError(err.message || "Login failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: "spring", duration: 0.4, bounce: 0.15 }}
            className="bg-zinc-900 border border-zinc-800 p-6 rounded-sm w-full max-w-sm relative z-10 shadow-2xl"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-850 p-1.5 rounded-sm transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-sm font-mono uppercase tracking-[0.2em] text-zinc-300 mb-6 flex items-center gap-2">
              <LogIn className="w-4 h-4 text-teal-400" />
              Cadet Login
            </h3>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="text-[10px] text-zinc-500 block mb-1 uppercase font-bold tracking-wider font-mono">
                  LeetCode Username
                </label>
                <input
                  type="text"
                  value={leetcodeUsername}
                  onChange={(e) => setLeetcodeUsername(e.target.value)}
                  className="w-full bg-zinc-950 text-zinc-100 placeholder-zinc-700 text-xs font-mono uppercase tracking-widest px-3 py-2.5 rounded-sm border border-zinc-800 focus:border-teal-500 focus:outline-none transition-all"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="text-[10px] text-zinc-500 block mb-1 uppercase font-bold tracking-wider font-mono">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-zinc-950 text-zinc-100 placeholder-zinc-700 text-xs font-mono tracking-widest px-3 py-2.5 rounded-sm border border-zinc-800 focus:border-teal-500 focus:outline-none transition-all"
                  required
                />
              </div>

              {error && (
                <div className="bg-red-950/20 text-red-400 text-xs p-3 rounded-sm border border-red-500/20 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-teal-500 hover:bg-teal-400 text-black font-black uppercase tracking-widest text-xs py-3 rounded-sm transition duration-200 shadow-md flex items-center justify-center gap-2 cursor-pointer mt-2 disabled:opacity-50"
              >
                {submitting ? "Logging in..." : "Log In"}
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
