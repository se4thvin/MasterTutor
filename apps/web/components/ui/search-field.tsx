import type { Ref } from "react";
import { Icon } from "./icon.tsx";

export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  shortcut,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  shortcut?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div className="search-field" role="search">
      <Icon name="search" size="sm" />
      <input
        ref={inputRef}
        type="search"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {shortcut ? (
        <kbd className="kbd" aria-hidden="true">
          {shortcut}
        </kbd>
      ) : null}
    </div>
  );
}
