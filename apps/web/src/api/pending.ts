// Counts requests that are still waiting for an answer, so the UI can say "the server is starting up" when a sleeping
// free-tier API takes a long time (SRS PERF-2).
export interface PendingTracker {
  start(): () => void; // returns the function to call when the request has finished
  count(): number;
  subscribe(listener: () => void): () => void;
}

export function createPendingTracker(): PendingTracker {
  let pending = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    start() {
      pending++;
      emit();
      let finished = false;
      return () => {
        if (finished) return;
        finished = true;
        pending--;
        emit();
      };
    },
    count: () => pending,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
