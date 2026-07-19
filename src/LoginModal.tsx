import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { LogIn, X } from "lucide-react";
import { useAuth } from "./AuthContext.js";

export default function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { loginWithIntra } = useAuth();

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

            <h3 className="text-sm font-mono uppercase tracking-[0.2em] text-zinc-300 mb-3 flex items-center gap-2">
              <LogIn className="w-4 h-4 text-teal-400" />
              Cadet Login
            </h3>

            <p className="text-xs text-zinc-500 mb-6 leading-relaxed">
              Login runs through your 42 (Intra) account — no separate password to
              remember. First time here? Signing in with 42 also starts your
              enrollment; you'll just add your LeetCode username afterward.
            </p>

            <button
              onClick={loginWithIntra}
              className="w-full bg-teal-500 hover:bg-teal-400 text-black font-black uppercase tracking-widest text-xs py-3 rounded-sm transition duration-200 shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              Continue with 42
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
