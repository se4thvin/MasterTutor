/** OpenObserve stores metric streams and labels with dots as underscores (spec §5.3, pinned in o2-api.ts). */
export function o2StreamName(name: string): string {
  return name.replaceAll(".", "_");
}

export const o2Label = o2StreamName;
