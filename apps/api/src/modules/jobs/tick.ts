// Timed jobs (SRS 3.4, Table 8). GitHub Actions calls POST /api/jobs/tick every 10 minutes; this is also what keeps the free
// Render service awake. Every job must be idempotent (REL-3): a late, repeated or overlapping tick is harmless.
// Real idempotent jobs are registered below; the tick now uses the database (FR-2.18, FR-2.28).
import type { AppDeps } from '../../lib/deps';
import { autoCloseBookings, restoreBlockedAccounts, cleanupSessions } from './timed-jobs';

export interface Job {
  name: string;
  /** Returns how many rows it changed. Must be safe to run twice. */
  run(deps: AppDeps): Promise<number>;
}

export interface JobResult {
  name: string;
  ok: boolean;
  affected: number;
  ms: number;
  error?: string; // generic on purpose: details go to the server log, not to the caller
}

export interface TickResult {
  ok: boolean; // false if any job failed: the workflow turns red
  ranAt: string;
  jobs: JobResult[];
}

export const ALL_JOBS: Job[] = [autoCloseBookings, restoreBlockedAccounts, cleanupSessions];

/** Runs jobs one after another. One failing job never stops the others. */
export async function runTick(deps: AppDeps, jobs: Job[] = ALL_JOBS): Promise<TickResult> {
  const results: JobResult[] = [];
  for (const job of jobs) {
    const started = performance.now();
    try {
      const affected = await job.run(deps);
      results.push({ name: job.name, ok: true, affected, ms: Math.round(performance.now() - started) });
    } catch (err) {
      deps.logger.error('job failed', { job: job.name, error: err instanceof Error ? err.message : String(err) });
      results.push({ name: job.name, ok: false, affected: 0, ms: Math.round(performance.now() - started), error: 'failed' });
    }
  }
  return { ok: results.every((r) => r.ok), ranAt: deps.clock.now().toISOString(), jobs: results };
}
