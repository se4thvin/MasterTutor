/*
 * Adapted from React Bits "FolderFloat" (TS-TW).
 * Source:  https://reactbits.dev/r/FolderFloat-TS-TW.json
 * sha256:  bf022a99900cdbe6963fdad3a3d5b722b11f3cd9cf2f5a1eb07a5fdecf8b5fba (fetched 2026-10-06)
 * Licence: Copyright (c) 2026 David Haz, MIT + Commons Clause; see ./LICENSE-react-bits
 *          (https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md).
 *          Not for redistribution as a component kit.
 * Adaptations: the folder itself is kept (a tabbed back plate, paper sheets that rise, a front flap
 * that tilts open in 3D on perspective rotateX); the matter-js physics and the floating item pills
 * are removed (flinging pills is not a library task, and matter-js stays banned); the hover/click
 * trigger becomes an `open` prop the owner drives (hover and focus in CSS, drag-over by prop) plus
 * a `receiving` gulp after a drop; colours from tokens (--folder-*), sizes in rem, timing from
 * motion-tokens; the inline <style> keyframes and Tailwind arbitrary values moved to library.css
 * (.ff); only transform, translate, scale and opacity animate; under reduced motion the flap stays
 * at rest and the paper only fades; the label is real text, so the owning link is named by it.
 */
export function FolderFloat({
  label,
  sublabel,
  open = false,
  receiving = false,
}: {
  label: string;
  sublabel?: string;
  open?: boolean;
  receiving?: boolean;
}) {
  return (
    <span
      className="ff"
      data-open={open ? "" : undefined}
      data-receive={receiving ? "" : undefined}
    >
      <span className="ff-body">
        <span className="ff-back" aria-hidden="true" />
        <span className="ff-paper" aria-hidden="true" />
        <span className="ff-paper ff-paper-2" aria-hidden="true" />
        <span className="ff-front">
          <span className="ff-label">{label}</span>
          {sublabel ? <span className="ff-sub">{sublabel}</span> : null}
        </span>
      </span>
    </span>
  );
}
