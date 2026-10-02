-- Fair Share Cloudflare D1 schema.
-- Trips are stored as a single JSON payload (same shape as the old Netlify Blob
-- records, including the internal pin_hash which is stripped by the API).
-- Photo binaries live in R2; photo metadata (contentType, uploadedAt,
-- hasOriginal) is stored as R2 object custom metadata, so no photo table is
-- needed. PIN attempt counters live in KV with TTL.

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- PIN attempt counters (replaces the KV read-then-write limiter, which let
-- parallel guesses through). Keys: pin:attempts:<trip>:<ip or /64> (15 min)
-- and pin:trip:<trip> (24 h). reset_at is epoch milliseconds.
CREATE TABLE IF NOT EXISTS pin_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
