import { Icon, type IconName } from "@/components/ui/icon.tsx";

/**
 * A folder glyph that floats when its row is hovered and lifts its lid (the closed glyph
 * cross-fades to the open one, raised) while something can drop into it. The motion idea is React
 * Bits' FolderFloat; no code is copied. Transform and opacity only, in library.css (.fmark).
 */
export function FolderMark({
  name,
  openName = "folderOpen",
  lift = false,
}: {
  name: IconName;
  openName?: IconName | null;
  lift?: boolean;
}) {
  return (
    <span className="fmark" aria-hidden="true" data-lift={lift ? "" : undefined}>
      <Icon name={name} size="sm" className="fmark-shut" />
      {openName ? <Icon name={openName} size="sm" className="fmark-open" /> : null}
    </span>
  );
}
