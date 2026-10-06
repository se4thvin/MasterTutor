import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon.tsx";

export function Chip({
  icon,
  children,
  onRemove,
  removeLabel,
}: {
  icon?: IconName;
  children: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <span className="chip">
      {icon ? <Icon name={icon} size="sm" /> : null}
      <span className="chip-text">{children}</span>
      {onRemove ? (
        <button
          type="button"
          className="chip-x"
          aria-label={removeLabel ?? "Remove"}
          onClick={onRemove}
        >
          <Icon name="close" size="sm" />
        </button>
      ) : null}
    </span>
  );
}
