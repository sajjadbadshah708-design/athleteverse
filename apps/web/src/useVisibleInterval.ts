import { useEffect, useRef } from 'react';

/**
 * Calls `callback` every `ms` milliseconds, but only while the page is visible: a hidden tab or a phone in the pocket does no
 * polling (SRS PERF-5, battery and data). When the page becomes visible again it refreshes at once.
 */
export function useVisibleInterval(callback: () => void, ms: number): void {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      timer = setInterval(() => latest.current(), ms);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        latest.current();
        start();
      } else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ms]);
}
