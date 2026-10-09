"use client";
/*
 * Adapted from React Bits "AnimatedList" (TS-TW).
 * Source:  https://reactbits.dev/r/AnimatedList-TS-TW.json
 * sha256:  15789322a444db2495de3f099a9c28140b3c3834b293e6b3aa4425ef45280992 (fetched 2026-10-08)
 * Licence: Copyright (c) 2026 David Haz, MIT + Commons Clause; see ./LICENSE-react-bits
 *          (https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md).
 *          Not for redistribution as a component kit.
 * Adaptations: CSS-only entrance (no motion runtime): an item that arrives after the list first
 * renders enters on opacity and transform with the shared spring (`@starting-style`, run.css
 * .alist-item[data-enter]); the history already there never animates, and nothing leaves on
 * scroll (the in-view toggle is gone). The top and bottom scroll-edge gradients stay, written on
 * opacity through refs (no render per scroll). The window-wide arrow/Tab/Enter handler, the
 * selection state and the hard-coded sizes and colours are removed; items are the caller's
 * <li> content, the list is an <ol> the caller labels; colours from tokens; reduced motion keeps
 * only the fade (motion.css).
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

/** How far from an edge (px) its gradient is fully shown. */
const EDGE_PX = 48;

const Settled = createContext<RefObject<boolean> | null>(null);

export function AnimatedList({
  listRef,
  children,
  label,
}: {
  listRef: RefObject<HTMLOListElement | null>;
  children: ReactNode;
  label?: string;
}) {
  const settled = useRef(false);
  const top = useRef<HTMLSpanElement>(null);
  const bottom = useRef<HTMLSpanElement>(null);
  const paint = () => {
    const list = listRef.current;
    if (!list) return;
    const below = list.scrollHeight - list.scrollTop - list.clientHeight;
    if (top.current) top.current.style.opacity = String(Math.min(1, list.scrollTop / EDGE_PX));
    if (bottom.current) bottom.current.style.opacity = String(Math.min(1, below / EDGE_PX));
  };
  useEffect(() => {
    settled.current = true;
    paint();
    const list = listRef.current;
    if (!list) return undefined;
    const observer = new ResizeObserver(paint);
    observer.observe(list);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paint reads refs only
  }, []);
  return (
    <div className="alist">
      <ol ref={listRef} className="alist-list" aria-label={label} onScroll={paint}>
        <Settled value={settled}>{children}</Settled>
      </ol>
      <span ref={top} className="alist-edge" data-edge="top" aria-hidden="true" />
      <span ref={bottom} className="alist-edge" data-edge="bottom" aria-hidden="true" />
    </div>
  );
}

/** One row; it animates in only when it arrives after the list's first render. */
export function AnimatedItem({
  className,
  children,
  ...data
}: {
  className?: string;
  children: ReactNode;
} & Record<`data-${string}`, string | boolean | undefined>) {
  const settled = useContext(Settled);
  const [enter] = useState(() => settled?.current === true);
  return (
    <li
      className={className ? `alist-item ${className}` : "alist-item"}
      data-enter={enter || undefined}
      {...data}
    >
      {children}
    </li>
  );
}
