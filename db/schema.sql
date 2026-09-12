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
