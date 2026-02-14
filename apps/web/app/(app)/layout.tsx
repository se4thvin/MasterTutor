import type { ReactNode } from "react";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <main id="main">{children}</main>;
}
