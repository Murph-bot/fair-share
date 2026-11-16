-- Fixed-window counters for the API's rate limits. Additive: the code deployed
-- before this change never reads the table.
-- Apply before deploying the code that reads it.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_expires_at ON rate_limits (expires_at);
