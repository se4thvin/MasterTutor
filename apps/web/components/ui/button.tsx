import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx.ts";
import { Icon, type IconName } from "./icon.tsx";

type Variant = "primary" | "gray" | "plain" | "danger";
interface Look {
  variant?: Variant;
  size?: "md" | "lg";
  icon?: IconName;
}

const classes = ({ variant = "gray", size = "md" }: Look, className?: string) =>
  cx("btn", `btn-${variant}`, size === "lg" && "btn-lg", className);

export function Button({
  variant,
  size,
  icon,
  className,
  children,
  type = "button",
  ...rest
}: Look & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={classes({ variant, size }, className)} {...rest}>
      {icon ? <Icon name={icon} size="sm" /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant,
  size,
  icon,
  className,
  children,
}: Look & { href: string; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={classes({ variant, size }, className)}>
      {icon ? <Icon name={icon} size="sm" /> : null}
      {children}
    </Link>
  );
}

export function IconButton({
  icon,
  label,
  className,
  type = "button",
  ...rest
}: { icon: IconName; label: string } & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "aria-label"
>) {
  return (
    <button type={type} aria-label={label} className={cx("icon-btn", className)} {...rest}>
      <Icon name={icon} />
    </button>
  );
}
