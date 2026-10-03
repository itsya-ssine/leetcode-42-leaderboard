import React from "react";
import { AnimatePresence } from "motion/react";
import { LogIn } from "lucide-react";
import { useAuth } from "./AuthContext.js";
import Modal from "./Modal.js";

export default function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { loginWithIntra } = useAuth();

  return (
    <AnimatePresence>
      {open && (
        <Modal onClose={onClose} label="Log in" maxWidth="max-w-sm">
          <h3 className="pr-8 text-lg font-semibold tracking-tight text-white">
            Log in with your 42 account
          </h3>

          <p className="mt-2 text-sm leading-relaxed text-mist-400">
            You sign in through 42 (Intra), so there is no separate password to remember.
            If this is your first visit, you'll add your LeetCode username next to join
            the board.
          </p>

          <button
            type="button"
            onClick={loginWithIntra}
            className="mt-6 inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-teal-400 text-sm font-medium text-ink-950 transition-colors hover:bg-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
          >
            <LogIn className="size-4" />
            Continue with 42
          </button>
        </Modal>
      )}
    </AnimatePresence>
  );
}
