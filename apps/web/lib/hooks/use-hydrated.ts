import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False while the component hydrates, so it renders what the server rendered; true once it has
 * (React re-renders it then), and true at once for a component that mounts on the client.
 */
export const useHydrated = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
