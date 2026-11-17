import type { Tier } from './enums';

// Credit tiers (SRS Figure 7). One function, used by the booking rules now and by the credit engine and the player's badge later.

export interface TierThresholds {
  good: number; // a score at or above this is Good (default 70)
  caution: number; // at or above this is Caution (default 40)
}

/** Score 70 or more is Good, 40 to 69 Caution, 1 to 39 Restricted, and 0 is Blocked. The thresholds are platform settings. */
export function tierOf(score: number, thresholds: TierThresholds): Tier {
  if (score <= 0) return 'BLOCKED';
  if (score >= thresholds.good) return 'GOOD';
  if (score >= thresholds.caution) return 'CAUTION';
  return 'RESTRICTED';
}
