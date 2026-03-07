import type { ReactNode } from "react";

export function PageHead({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="pagehead">
      <div className="min-w-0">
        <h1 className="t-large">
          {title}
          <span className="period" aria-hidden="true">
            .
          </span>
        </h1>
        {lede ? <p className="pagehead-lede">{lede}</p> : null}
      </div>
      {children ? <div className="pagehead-actions">{children}</div> : null}
    </div>
  );
}
