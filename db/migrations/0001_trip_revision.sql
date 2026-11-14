-- Apply before deploying the code that reads it. The old code ignores the column.
ALTER TABLE trips ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
