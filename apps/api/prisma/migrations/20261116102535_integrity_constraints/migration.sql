-- Integrity constraints Prisma cannot model (SRS Table 30, section 10.1 "last line of defence").
-- Installed ONCE as the migration "<timestamp>_integrity_constraints" by `npm run db:init`
-- (scripts/install-integrity-migration.mjs). After that, migrations are immutable: change constraints with NEW migrations.
-- Maps to: FR-2.9, FR-1.2, FR-1.18, FR-2.24, SEC-8, SA-1, rule 5 (three-layer double-booking protection, layer 3).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ===== reference data =====
ALTER TABLE sports
  ADD CONSTRAINT sports_team_size_valid CHECK (min_team_size >= 1 AND max_team_size >= min_team_size);

-- ===== accounts =====
ALTER TABLE users
  ADD CONSTRAINT users_credit_score_range CHECK (credit_score BETWEEN 0 AND 100),            -- Table 30
  ADD CONSTRAINT users_owner_is_admin     CHECK (NOT is_owner OR role = 'ADMIN'),            -- SA-1
  ADD CONSTRAINT users_email_lowercase    CHECK (email = lower(email)),                      -- FR-1.2 uniqueness is case-blind
  ADD CONSTRAINT users_phone_digits       CHECK (phone ~ '^[0-9]{9,15}$');                   -- Table 10

ALTER TABLE player_profiles
  ADD CONSTRAINT player_profiles_area_length CHECK (area IS NULL OR char_length(area) <= 50);

ALTER TABLE manager_profiles
  ADD CONSTRAINT manager_profiles_business_name_length CHECK (char_length(business_name) BETWEEN 3 AND 80);

-- ===== venues and courts (Table 11, D1) =====
ALTER TABLE venues
  ADD CONSTRAINT venues_name_length   CHECK (char_length(name) BETWEEN 3 AND 80),
  ADD CONSTRAINT venues_description_length CHECK (description IS NULL OR char_length(description) <= 500),
  ADD CONSTRAINT venues_hours_valid   CHECK (open_hour BETWEEN 0 AND 23 AND close_hour BETWEEN 1 AND 24 AND close_hour > open_hour),
  ADD CONSTRAINT venues_peak_valid    CHECK (
    (peak_start_hour IS NULL AND peak_end_hour IS NULL)
    OR (peak_start_hour IS NOT NULL AND peak_end_hour IS NOT NULL
        AND peak_start_hour >= open_hour AND peak_end_hour > peak_start_hour AND peak_end_hour <= close_hour)),
  ADD CONSTRAINT venues_geo_range     CHECK (
    (latitude  IS NULL OR latitude  BETWEEN -90  AND 90) AND
    (longitude IS NULL OR longitude BETWEEN -180 AND 180));

CREATE UNIQUE INDEX venues_city_name_uq  ON venues (city_id, lower(name));      -- unique within a city, case-insensitive
CREATE UNIQUE INDEX courts_venue_name_uq ON courts (venue_id, lower(name));     -- unique within a venue, case-insensitive

ALTER TABLE courts
  ADD CONSTRAINT courts_name_length            CHECK (char_length(name) BETWEEN 1 AND 30),
  ADD CONSTRAINT courts_price_regular_positive CHECK (price_regular > 0),
  ADD CONSTRAINT courts_price_peak_positive    CHECK (price_peak IS NULL OR price_peak > 0);

-- ===== blocks (N1) =====
ALTER TABLE court_blocks
  ADD CONSTRAINT blocks_valid_range CHECK (end_time > start_time),
  ADD CONSTRAINT blocks_no_overlap  EXCLUDE USING gist
    (court_id WITH =, (tstzrange(start_time, end_time, '[)')) WITH &&);

-- ===== bookings: layer 3 of the double-booking protection (FR-2.9, D3/N3) =====
ALTER TABLE bookings
  ADD CONSTRAINT bookings_valid_duration CHECK (end_time - start_time IN (interval '1 hour', interval '2 hours', interval '3 hours')),
  ADD CONSTRAINT bookings_total_price_positive CHECK (total_price > 0),
  ADD CONSTRAINT bookings_paid_has_amount CHECK ((payment_status = 'PAID') = (amount_received IS NOT NULL)),
  ADD CONSTRAINT bookings_cancel_fields   CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)),
  ADD CONSTRAINT bookings_no_court_overlap  EXCLUDE USING gist
    (court_id  WITH =, (tstzrange(start_time, end_time, '[)')) WITH &&) WHERE (status IN ('CONFIRMED', 'COMPLETED')),
  ADD CONSTRAINT bookings_no_player_overlap EXCLUDE USING gist
    (player_id WITH =, (tstzrange(start_time, end_time, '[)')) WITH &&) WHERE (status IN ('CONFIRMED', 'COMPLETED'));

-- ===== credit ledger (FR-2.24) =====
ALTER TABLE credit_events
  ADD CONSTRAINT credit_events_score_after_range CHECK (score_after BETWEEN 0 AND 100);

-- ===== audit log is append-only (SEC-8, SA-12) =====
CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END $$;

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
