"use client";

import type { VaultItemView } from "@mastertutor/contracts";
import { StatusMark } from "@/components/bits/status-mark.tsx";
import { Button, IconButton } from "@/components/ui/button.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { Menu, MenuItem, MenuPanel } from "@/components/ui/menu.tsx";
import { hostOf } from "@/lib/notes/format.ts";
import { FIELD_META } from "@/lib/vault/fields.ts";

export function VaultRow({
  item,
  onSignOut,
  onReplace,
  onDelete,
}: {
  item: VaultItemView;
  onSignOut: (item: VaultItemView) => void;
  /** The actions menu appears only when at least one of these is provided. */
  onReplace?: (item: VaultItemView) => void;
  onDelete?: (item: VaultItemView) => void;
}) {
  return (
    <li className="vrow">
      <span className="vrow-art">
        <Icon name="web" />
      </span>
      <div className="vrow-id">
        <span className="mono vrow-alias">{item.alias}</span>
        <span className="t-foot vrow-host">
          {item.label} · {hostOf(item.origin)}
        </span>
      </div>
      <ul className="ftypes" aria-label={`Fields for ${item.alias}`}>
        {item.fields.map((f) => (
          <li key={f} className="ft">
            <Icon name={FIELD_META[f].icon} size="sm" />
            {FIELD_META[f].label}
            {FIELD_META[f].secret ? <span className="ft-seal">sealed</span> : null}
          </li>
        ))}
        <li className="ft ft-tint">
          <Icon name="codeOtp" size="sm" />
          Codes you type in a run
        </li>
      </ul>
      <div className="vrow-session">
        <StatusMark status={item.sessionSaved ? "done" : "pending"} decorative />
        <span>{item.sessionSaved ? "Session saved" : "Signs in on next use"}</span>
      </div>
      <div className="vrow-actions">
        {item.sessionSaved ? (
          <Button
            variant="plain"
            aria-label={`Sign out of ${item.alias}`}
            onClick={() => onSignOut(item)}
          >
            Sign out
          </Button>
        ) : null}
        {onReplace || onDelete ? (
          <Menu.Root>
            <Menu.Trigger render={<IconButton icon="more" label={`Actions for ${item.alias}`} />} />
            <MenuPanel>
              {onReplace ? (
                <MenuItem icon="password" onSelect={() => onReplace(item)}>
                  Replace or add a value…
                </MenuItem>
              ) : null}
              {onDelete ? (
                <MenuItem icon="delete" destructive onSelect={() => onDelete(item)}>
                  Delete sign-in…
                </MenuItem>
              ) : null}
            </MenuPanel>
          </Menu.Root>
        ) : null}
      </div>
    </li>
  );
}
