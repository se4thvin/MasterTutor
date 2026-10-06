const COLORS = [
  "bg", "bg-2", "elevated", "label", "label-2", "hairline", "fill", "tint", "tint-text",
  "signal", "navy", "ok", "warn", "danger",
] as const;
const TYPE = [
  ["t-large", "Large title"],
  ["t-title1", "Title 1"],
  ["t-title2", "Title 2"],
  ["t-title3", "Title 3"],
  ["t-callout", "Callout"],
  ["t-foot", "Footnote"],
  ["eyebrow", "Eyebrow"],
  ["cap", "Caption"],
  ["mono", "Mono 12 · 0123456789"],
] as const;
const RADII = ["xs", "sm", "md", "lg", "xl", "frame"] as const;
const SHADOWS = [
  ["e1", "shadow-e1"],
  ["e2", "shadow-e2"],
  ["e3", "shadow-e3"],
] as const;

export function FoundationsSection() {
  return (
    <div className="grid gap-10">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7" aria-label="Colour tokens">
        {COLORS.map((name) => (
          <li key={name} className="grid gap-1.5">
            <span className="h-12 rounded-md shadow-e1" style={{ background: `var(--${name})` }} />
            <code className="mono text-label-2">--{name}</code>
          </li>
        ))}
      </ul>
      <ul className="grid gap-3" aria-label="Type scale">
        {TYPE.map(([cls, label]) => (
          <li key={cls} className={cls}>
            {label}
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap gap-4" aria-label="Radii and elevation">
        {RADII.map((r) => (
          <li key={r} className="grid size-20 place-items-center bg-elevated shadow-e1" style={{ borderRadius: `var(--r-${r})` }}>
            <span className="mono">{r}</span>
          </li>
        ))}
        {SHADOWS.map(([s, cls]) => (
          <li key={s} className={`grid size-20 place-items-center rounded-lg bg-elevated ${cls}`}>
            <span className="mono">{s}</span>
          </li>
        ))}
      </ul>
      <div className="design-glass-demo rounded-xl p-6">
        <div className="glass rounded-lg p-4">
          <p className="t-title3">Glass</p>
          <p className="t-callout text-label-2">saturate(180%) blur(24px) at 72% fill. Opaque with reduced transparency.</p>
        </div>
      </div>
    </div>
  );
}
