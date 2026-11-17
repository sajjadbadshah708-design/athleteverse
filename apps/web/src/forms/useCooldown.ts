import { useEffect, useState } from 'react';

/** A countdown in whole seconds (for "ask for a new code in 42 s"). Based on a deadline, so it stays right if the tab sleeps. */
export function useCooldown(initialSeconds: number) {
  const [seconds, setSeconds] = useState(initialSeconds);
  const [deadline, setDeadline] = useState(() => Date.now() + initialSeconds * 1000);

  useEffect(() => {
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSeconds(left);
      if (left === 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [deadline]);

  return {
    seconds,
    restart(next: number) {
      setSeconds(next);
      setDeadline(Date.now() + next * 1000);
    },
  };
}
