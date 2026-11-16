-- Fair Share Cloudflare D1 schema.
-- Trips are stored as a single JSON payload (same shape as the old Netlify Blob
-- records, including the internal pin_hash which is stripped by the API).
-- Photo binaries live in R2; photo metadata (contentType, uploadedAt,
-- hasOriginal) is stored as R2 object custom metadata, so no photo table is
-- needed. Rate limit and PIN attempt counters live in rate_limits.

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Bumped on every save. A save must name the revision it was made from.
  revision INTEGER NOT NULL DEFAULT 0
);

-- Fixed-window counters for rate limits (migration 0002). Rows are pruned once
-- expires_at (unix seconds) has passed.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_expires_at ON rate_limits (expires_at);
