import type { MetadataRoute } from "next";
import { APP_MARK_COLORS } from "@/lib/app-mark-colors.ts";

/** Installable on the iPhone Home Screen (iOS 16.4+), which Web Push needs there (spec §13.4). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MasterTutor",
    short_name: "MasterTutor",
    start_url: "/library",
    scope: "/",
    display: "standalone",
    background_color: APP_MARK_COLORS.glyph,
    theme_color: APP_MARK_COLORS.glyph,
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png" },
    ],
  };
}
