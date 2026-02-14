import { useId, type InputHTMLAttributes } from "react";
import { cx } from "@/lib/cx.ts";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "children"> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function TextField({ label, hint, error, id, className, ...input }: TextFieldProps) {
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
        <p id={errorId} className="tf-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
