-- SwasthID dose-reminder pushes (Cloudflare D1).
-- Only times, weekdays and time zones are stored: never medicine names. The
-- phone looks up which medicines are due when the push arrives.

-- One row per browser that turned reminders on.
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,          -- SHA-256 of the push endpoint
  uid TEXT NOT NULL,            -- Firebase user ID (for account deletion)
  endpoint TEXT NOT NULL,       -- push service URL for this browser
  tz TEXT NOT NULL,             -- IANA time zone, e.g. Asia/Kolkata
  updated_at INTEGER NOT NULL,
  p256dh TEXT,                  -- the browser's keys for encrypting messages
  auth TEXT
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

-- Dose times marked taken, per account and local date, so no nudge is sent
-- for them. Kept for three days.
CREATE TABLE IF NOT EXISTS taken (
  uid TEXT NOT NULL,
  day TEXT NOT NULL,            -- YYYY-MM-DD, local date
  time TEXT NOT NULL,           -- HH:MM
  created_at INTEGER NOT NULL,
  PRIMARY KEY (uid, day, time)
);

-- "Snooze 10 min": remind this browser about these dose times at `due`
-- (minutes since 1970).
CREATE TABLE IF NOT EXISTS snoozes (
  sub_id TEXT NOT NULL,
  due INTEGER NOT NULL,
  day TEXT NOT NULL,
  times TEXT NOT NULL           -- JSON list of HH:MM
);
CREATE INDEX IF NOT EXISTS snoozes_due ON snoozes (due);

-- The Worker adds anything missing here by itself (ensureSchema in
-- src/index.js), so a database made from an older copy of this file keeps working.
