import { Icon } from "@/components/ui/icon.tsx";
import { icons, type IconName } from "@/components/ui/icons.ts";

export function IconGallerySection() {
  const names = Object.keys(icons) as IconName[];
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8" aria-label="Icon registry">
      {names.map((name) => (
        <li key={name} className="grid min-w-0 justify-items-center gap-1 rounded-md bg-bg-2 p-3">
          <Icon name={name} size="lg" label={name} />
          <span className="t-foot w-full truncate text-center">{name}</span>
        </li>
      ))}
    </ul>
  );
}
