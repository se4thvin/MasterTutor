import { SourceKind, Uuid } from "@mastertutor/contracts";

export type LibraryScope = "all" | "unfiled" | (string & {});
export type LibraryViewMode = "grid" | "list";

export interface LibraryParams {
  folder: LibraryScope;
  kind: SourceKind | null;
  view: LibraryViewMode;
  q: string;
}

export function parseLibraryParams(search: { get(name: string): string | null }): LibraryParams {
  const folderRaw = search.get("folder");
  const folder: LibraryScope =
    folderRaw === "unfiled"
      ? "unfiled"
      : folderRaw !== null && Uuid.safeParse(folderRaw).success
        ? folderRaw
        : "all";
  const kind = SourceKind.safeParse(search.get("kind"));
  return {
    folder,
    kind: kind.success ? kind.data : null,
    view: search.get("view") === "list" ? "list" : "grid",
    q: (search.get("q") ?? "").slice(0, 500),
  };
}

export function libraryHref(params: Partial<LibraryParams>): string {
  const search = new URLSearchParams();
  if (params.folder && params.folder !== "all") search.set("folder", params.folder);
  if (params.kind) search.set("kind", params.kind);
  if (params.view === "list") search.set("view", "list");
  if (params.q) search.set("q", params.q);
  const qs = search.toString();
  return qs ? `/library?${qs}` : "/library";
}
