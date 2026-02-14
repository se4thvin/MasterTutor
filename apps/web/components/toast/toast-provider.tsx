"use client";

import { AnimatePresence, m } from "motion/react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { SwipeToast } from "@/components/bits/swipe-toast.tsx";
import type { IconName } from "@/components/ui/icon.tsx";
import { transitions } from "@/lib/motion-tokens.ts";

export interface ToastInput {
  title: string;
  description?: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "neutral" | "danger";
}

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);
const MAX_TOASTS = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Array<ToastInput & { id: number }>>([]);
  const nextId = useRef(0);
  const show = useCallback((toast: ToastInput) => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((list) => [...list.slice(-(MAX_TOASTS - 1)), { ...toast, id }]);
  }, []);
  const dismiss = useCallback(
    (id: number) => setToasts((list) => list.filter((t) => t.id !== id)),
    [],
  );
  return (
    <ToastContext value={show}>
      {children}
      <section className="toast-region" aria-label="Notifications" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <m.div
              key={t.id}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={transitions.spring}
            >
              <SwipeToast {...t} onClose={() => dismiss(t.id)} />
            </m.div>
          ))}
        </AnimatePresence>
      </section>
    </ToastContext>
  );
}

export function useToast(): (toast: ToastInput) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside <ToastProvider>");
  return show;
}
