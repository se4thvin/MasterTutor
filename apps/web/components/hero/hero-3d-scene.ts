/** Temporary stub so the dynamic import resolves; Task 21 replaces it with the three scene. */
interface HeroOptions {
  debug?: boolean;
}
export async function createHero(
  _el: HTMLElement,
  _options: HeroOptions = {},
): Promise<{ destroy(): void } | null> {
  return null;
}
