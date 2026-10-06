"use client";

import type { ReactNode } from "react";
import { MotionProvider } from "@/components/motion/motion-provider.tsx";

export function Providers({ children }: { children: ReactNode }) {
  return <MotionProvider>{children}</MotionProvider>;
}
