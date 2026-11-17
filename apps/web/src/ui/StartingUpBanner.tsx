import { STRINGS } from '@athleteverse/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useApi } from '../api/ApiContext';
import { Alert } from './Alert';

export const SLOW_AFTER_MS = 3000;

/** A free API that has been asleep needs up to a minute to wake: say so instead of looking broken (SRS PERF-2). */
export function StartingUpBanner() {
  const { pending } = useApi();
  const count = useSyncExternalStore(pending.subscribe, pending.count);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (count === 0) return;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [count]);

  if (!slow || count === 0) return null;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4">
      <Alert tone="info">{STRINGS.banner.startingUp}</Alert>
    </div>
  );
}
