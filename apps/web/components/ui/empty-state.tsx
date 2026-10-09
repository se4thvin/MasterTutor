import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon.tsx";

export function EmptyState({
  icon,
  art,
  eyebrow,
  title,
  body,
  actions,
}: {
  icon: IconName;
  /** Replaces the icon in the art tile (a compact Pip). */
  art?: ReactNode;
  eyebrow?: string;
  title: string;
  body?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="empty" role="status">
      <span className="empty-art">{art ?? <Icon name={icon} size="xl" />}</span>
      <div className="min-w-0">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h2 className="t-title1 mt-2">
          {title}
          <span className="period" aria-hidden="true">
            .
          </span>
        </h2>
        {body ? <p className="empty-body">{body}</p> : null}
        {actions ? <div className="empty-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
