import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon.tsx";

export function EmptyState({
  icon,
  eyebrow,
  title,
  body,
  actions,
}: {
  icon: IconName;
  eyebrow?: string;
  title: string;
  body: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="empty" role="status">
      <span className="empty-art">
        <Icon name={icon} size="xl" />
      </span>
      <div className="min-w-0">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h2 className="t-title1 mt-2">
          {title}
          <span className="period" aria-hidden="true">
            .
          </span>
        </h2>
        <p className="empty-body">{body}</p>
        {actions ? <div className="empty-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
