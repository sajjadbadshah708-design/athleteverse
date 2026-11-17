// Seeded platform settings (SRS Table 26). Read-only in the MVP (K3, FR-5.12 Later).
// The 60-minute slot length is a code constant, not a setting (Table 26 "fixed, not editable").
export const SETTING_DEFAULTS = {
  advance_days: 14, // Table 14
  min_lead_minutes: 30, // latest booking before start
  max_slots: 3,
  free_cancel_hours: 6, // Table 16
  last_minute_hours: 1,
  no_show_wait_minutes: 15,
  outcome_auto_close_hours: 24,
  penalty_late: 10,
  penalty_lastmin: 20,
  penalty_noshow: 30,
  penalty_unpaid: 50,
  recovery: 5,
  tier_good: 70, // Figure 7: score >= 70 Good, >= 40 Caution, 1..39 Restricted, 0 Blocked
  tier_caution: 40,
  upcoming_limits: { GOOD: 3, CAUTION: 2, RESTRICTED: 1, BLOCKED: 0 },
  blocked_restore_days: 30,
  blocked_restore_score: 20,
  sessions_per_user: 5,
};

export type SettingKey = keyof typeof SETTING_DEFAULTS;
