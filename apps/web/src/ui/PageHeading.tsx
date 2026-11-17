import { useEffect, useRef, type ReactNode } from 'react';

// Which heading of this visit is this? The very first one must NOT take focus: on a fresh page load the keyboard user starts at
// the top, and the first Tab has to reach the "Skip to content" link. Every later heading (a real navigation) takes focus, so
// screen reader users hear which page they are on (WCAG 2.4.3).
let headingsShown = 0;

/** For tests only: makes the next heading count as the first one again. */
export function resetInitialHeadingFocus(): void {
  headingsShown = 0;
}

export function PageHeading({ children }: { children: ReactNode }) {
  const element = useRef<HTMLHeadingElement>(null);
  const order = useRef<number | null>(null); // survives React StrictMode's second run of effects in development

  useEffect(() => {
    order.current ??= headingsShown++;
    if (order.current > 0) element.current?.focus({ preventScroll: true });
  }, []);

  return (
    <h1 ref={element} tabIndex={-1} className="av-page-title mb-5 outline-none">
      {children}
    </h1>
  );
}
