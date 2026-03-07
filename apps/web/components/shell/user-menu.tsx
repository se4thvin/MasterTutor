"use client";

import { useRouter } from "next/navigation";
import { Menu, MenuItem, MenuPanel } from "@/components/ui/menu.tsx";
import type { Viewer } from "@/lib/server/viewer.ts";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";

export function UserMenu({
  viewer,
  onSignOut,
}: {
  viewer: Viewer;
  onSignOut: () => Promise<void>;
}) {
  const router = useRouter();
  return (
    <Menu.Root>
      <Menu.Trigger className="me" aria-label={`Account: ${viewer.name}`}>
        <span className="avatar" aria-hidden="true">
          {initials(viewer.name)}
        </span>
        <span className="me-text">
          <b>{viewer.name}</b>
          <small>{viewer.email}</small>
        </span>
      </Menu.Trigger>
      <MenuPanel align="start">
        <MenuItem icon="settings" onSelect={() => router.push("/settings")}>
          Settings
        </MenuItem>
        <MenuItem icon="signOut" onSelect={() => void onSignOut()}>
          Sign out
        </MenuItem>
      </MenuPanel>
    </Menu.Root>
  );
}
