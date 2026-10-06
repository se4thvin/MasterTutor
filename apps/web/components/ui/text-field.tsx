import { useId, type InputHTMLAttributes } from "react";
import { cx } from "@/lib/cx.ts";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "children"> {
  label: string;
  hint?: string;
  error?: string | null;
  /** False when the form announces one summary itself, so field errors don't talk over it. */
  announceError?: boolean;
}

export function TextField({
  label,
  hint,
  error,
  announceError = true,
  id,
  className,
  ...input
}: TextFieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("tf", className)}>
      <label htmlFor={inputId} className="tf-label">
        {label}
      </label>
      <input
        id={inputId}
        className="tf-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...input}
      />
      {hint ? (
        <p id={hintId} className="tf-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="tf-error" role={announceError ? "alert" : undefined}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
