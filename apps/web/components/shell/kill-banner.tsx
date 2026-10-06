"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Icon } from "@/components/ui/icon.tsx";
import { orpc } from "@/lib/api/client.ts";

export function KillBanner() {
  const { data } = useQuery(orpc.settings.get.queryOptions({ input: {} }));
  if (!data?.killSwitch) return null;
  return (
    <div className="kill-banner" role="status">
      <Icon name="stop" />
      <span>
        <b>Kill switch is on.</b> No run will start until you turn it off.
      </span>
      <Link href="/settings">Settings</Link>
    </div>
  );
}
