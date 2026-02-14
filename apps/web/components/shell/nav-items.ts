import type { IconName } from "@/components/ui/icon.tsx";

export const NAV_ITEMS: ReadonlyArray<{ href: string; label: string; icon: IconName }> = [
  { href: "/new", label: "New task", icon: "newTask" },
  { href: "/runs", label: "Runs", icon: "runs" },
  { href: "/library", label: "Library", icon: "library" },
  { href: "/vault", label: "Vault", icon: "vault" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function isNavActive(pathname: string, href: string): boolean {
  if (pathname === href || pathname.startsWith(`${href}/`)) return true;
  return href === "/library" && pathname.startsWith("/notes/");
}
