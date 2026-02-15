import type { SourceKind } from "@mastertutor/contracts";

/**
 * Product-shot covers (mockup D): a small object on the soft cover, lifted by a shadow, drawn
 * from the page tokens so it follows light and dark. Decorative; the title carries the meaning.
 */
const SHADOW = "drop-shadow(0 8px 16px rgb(0 0 0 / 0.1))";
const SHADOW_LIFT = "drop-shadow(0 8px 16px rgb(0 0 0 / 0.14))";
const E = "var(--elevated)";
const L = "var(--label)";
const L3 = "var(--label-3)";
const SIGNAL = "var(--signal)";

const ART = {
  curve: (
    <>
      <rect x="10" y="10" width="180" height="120" rx="14" fill={E} style={{ filter: SHADOW }} />
      <path
        d="M30 110 L48 34 C90 34 120 60 140 84 S170 104 178 104"
        fill="none"
        stroke={L}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="48" cy="34" r="4.5" fill={SIGNAL} />
    </>
  ),
  curves: (
    <>
      <rect x="10" y="10" width="180" height="120" rx="14" fill={E} style={{ filter: SHADOW }} />
      <path d="M28 28C40 90 70 104 176 108" fill="none" stroke={L} strokeWidth="3" />
      <path d="M28 28C60 60 100 80 176 92" fill="none" stroke={L3} strokeWidth="3" />
      <path
        d="M28 70L40 36L52 78L64 30L76 86"
        fill="none"
        stroke={SIGNAL}
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </>
  ),
  code: (
    <>
      <rect x="16" y="16" width="168" height="108" rx="14" fill={E} style={{ filter: SHADOW }} />
      <path
        d="M76 50L56 70l20 20M124 50l20 20-20 20M108 44L92 96"
        fill="none"
        stroke={L}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  tree: (
    <>
      <path
        d="M100 36v20M100 56H52v24M100 56h48v24M100 56v24"
        stroke={L}
        strokeWidth="2.5"
        fill="none"
      />
      <g fill={E} stroke={L} strokeWidth="2.5">
        <rect x="78" y="14" width="44" height="24" rx="8" />
        <rect x="30" y="80" width="44" height="24" rx="8" />
        <rect x="78" y="80" width="44" height="24" rx="8" />
        <rect x="126" y="80" width="44" height="24" rx="8" stroke={SIGNAL} />
      </g>
    </>
  ),
  layers: (
    <>
      <rect x="40" y="18" width="120" height="80" rx="18" fill={L3} opacity="0.35" />
      <rect
        x="52"
        y="34"
        width="120"
        height="80"
        rx="18"
        fill={E}
        opacity="0.7"
        style={{ filter: SHADOW }}
      />
      <rect
        x="28"
        y="48"
        width="120"
        height="80"
        rx="18"
        fill={E}
        opacity="0.92"
        stroke="var(--hairline)"
        style={{ filter: SHADOW_LIFT }}
      />
    </>
  ),
  pdf: (
    <>
      <rect
        x="62"
        y="6"
        width="96"
        height="128"
        rx="6"
        fill={E}
        transform="rotate(6 110 70)"
        style={{ filter: "drop-shadow(0 6px 12px rgb(0 0 0 / 0.08))" }}
      />
      <rect x="50" y="4" width="96" height="128" rx="6" fill={E} style={{ filter: SHADOW_LIFT }} />
      <path
        d="M64 26h52M64 38h68M64 46h60M64 54h66M64 62h40"
        stroke={L3}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <rect x="64" y="74" width="68" height="36" rx="3" fill="var(--bg-2)" />
      <path d="M70 104l14-14 10 8 14-16 18 22" fill="none" stroke={L} strokeWidth="2" />
    </>
  ),
  mol: (
    <>
      <path
        d="M60 40L100 60L140 40M100 60v40M100 100L64 116M100 100l36 16"
        stroke={L}
        strokeWidth="2.5"
      />
      {(
        [
          [60, 40],
          [100, 60],
          [140, 40],
          [100, 100],
          [64, 116],
          [136, 116],
        ] as const
      ).map(([x, y], i) => (
        <circle
          key={`${x}-${y}`}
          cx={x}
          cy={y}
          r={i === 1 ? 14 : 10}
          fill={i === 3 ? SIGNAL : E}
          stroke={L}
          strokeWidth="2.5"
        />
      ))}
    </>
  ),
  play: (
    <>
      <rect
        x="10"
        y="18"
        width="180"
        height="104"
        rx="16"
        fill={L}
        style={{ filter: SHADOW_LIFT }}
      />
      <circle cx="100" cy="70" r="22" fill={E} />
      <path d="M94 59v22l18-11z" fill={L} />
    </>
  ),
  net: (
    <>
      <g stroke={L3} strokeWidth="1.2">
        {[30, 60, 90, 120].flatMap((a) =>
          [45, 70, 95].map((b) => (
            <path key={`${a}-${b}`} d={`M40 ${a + 5}L100 ${b}M100 ${b}L160 ${a > 60 ? 85 : 55}`} />
          )),
        )}
      </g>
      <g fill={E} stroke={L} strokeWidth="2.5">
        {[35, 65, 95, 125].map((y) => (
          <circle key={`i${y}`} cx="40" cy={y} r="8" />
        ))}
        {[45, 70, 95].map((y) => (
          <circle key={`h${y}`} cx="100" cy={y} r="8" />
        ))}
        <circle cx="160" cy="55" r="8" />
      </g>
      <circle cx="160" cy="85" r="8" fill={SIGNAL} />
    </>
  ),
} as const;

type ArtName = keyof typeof ART;

const BY_KIND: Record<SourceKind, readonly ArtName[]> = {
  web: ["curve", "code", "tree", "layers", "curves"],
  pdf: ["pdf", "mol"],
  youtube: ["play", "net"],
};

/** Stable across renders and sessions: the same note always gets the same shot. */
export function artFor(noteId: string, kind: SourceKind): ArtName {
  const options = BY_KIND[kind];
  let hash = 0;
  for (const ch of noteId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return options[hash % options.length] ?? "curve";
}

export function NoteArt({ name }: { name: ArtName }) {
  return (
    <svg viewBox="0 0 200 140" aria-hidden="true" focusable="false" className="card-art">
      {ART[name]}
    </svg>
  );
}
