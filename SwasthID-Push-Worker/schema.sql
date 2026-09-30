-- SwasthID dose-reminder pushes (Cloudflare D1).
-- Only times, weekdays and time zones are stored: never medicine names. The
-- phone looks up which medicines are due when the push arrives.

-- One row per browser that turned reminders on.
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,          -- SHA-256 of the push endpoint
  uid TEXT NOT NULL,            -- Firebase user ID (for account deletion)
  endpoint TEXT NOT NULL,       -- push service URL for this browser
  tz TEXT NOT NULL,             -- IANA time zone, e.g. Asia/Kolkata
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS subscriptions_uid ON subscriptions (uid);

-- One row per dose time. days: bit n set = due on weekday n (0 = Sunday).
-- month_day: set for monthly medicines (due only on that day of the month).
CREATE TABLE IF NOT EXISTS doses (
  sub_id TEXT NOT NULL,
  tz TEXT NOT NULL,
  time TEXT NOT NULL,           -- HH:MM, local time
  days INTEGER NOT NULL,
  month_day INTEGER
);
CREATE INDEX IF NOT EXISTS doses_due ON doses (tz, time);
CREATE INDEX IF NOT EXISTS doses_sub ON doses (sub_id);

-- Time zones in use, so the every-minute check doesn't scan every dose.
CREATE TABLE IF NOT EXISTS zones (tz TEXT PRIMARY KEY);
