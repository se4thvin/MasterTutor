import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers.tsx";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "MasterTutor", template: "%s · MasterTutor" },
  description: "Faithful notes, taken by an agent in its own browser.",
};

export const viewport: Viewport = { viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
