-- Lets the retention purge find idle trips without scanning every trip.
-- Additive and safe to apply before or after the code that uses it.
-- updated_at is already set on every write, so no backfill is needed.
CREATE INDEX IF NOT EXISTS trips_updated_at ON trips (updated_at);
