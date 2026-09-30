# SwasthID reminder Worker

Sends dose reminders to phones and computers when SwasthID is closed. It
runs on Cloudflare Workers' **free plan** with a free **D1** database. It
exists because the SwasthID server on Render sleeps when idle and can't wake
itself up at dose time.

## How it works

1. When someone turns on **Dose reminders** while logged in, their browser
   creates a push subscription. The SwasthID server checks who they are and
   passes this Worker the subscription's address, their time zone, and their
   dose times and weekdays.
2. Every minute, a cron trigger looks up which doses are due at that minute
   in each time zone and sends each of those browsers an empty push, signed
   with the VAPID key.
3. On the phone, SwasthID's service worker receives the push. It reads which
   medicines are due from the schedule the app saved on the device, and
   leaves out any already marked taken. Then it shows the notification.

**Medicine names are never sent here.** The database holds only times,
weekdays, time zones, push addresses and the Firebase user ID, which is used
to delete everything when an account is deleted.

## Setup (about 10 minutes, all free)

You need a free Cloudflare account and Node 22.

```bash
cd SwasthID-Push-Worker
npx wrangler@4 login                          # opens the browser once

# 1. The database
npx wrangler@4 d1 create swasthid-push        # copy the database_id it prints
#    ...into wrangler.toml (database_id = "...")
npx wrangler@4 d1 execute swasthid-push --remote --file=schema.sql

# 2. Keys
npm run keys                                  # prints VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY
openssl rand -hex 32                          # a shared secret for the server

# 3. Secrets (each command asks for the value)
npx wrangler@4 secret put VAPID_PUBLIC_KEY
npx wrangler@4 secret put VAPID_PRIVATE_KEY
npx wrangler@4 secret put VAPID_SUBJECT       # mailto:you@example.com
npx wrangler@4 secret put SHARED_SECRET       # the value from openssl

# 4. Deploy
npx wrangler@4 deploy                         # prints https://swasthid-push.<you>.workers.dev
```

Then, on the SwasthID server (Render → Environment), set:

| Variable | Value |
| --- | --- |
| `PUSH_WORKER_URL` | The URL `wrangler deploy` printed |
| `PUSH_WORKER_SECRET` | The same value as `SHARED_SECRET` |
| `VAPID_PUBLIC_KEY` | The same public key as above |

After the next deploy, `/health` on the server shows `pushReminders: true`.
In the app, turn dose reminders on (or off and on) and use **Send a test**.

Keep `VAPID_PRIVATE_KEY` and `SHARED_SECRET` secret. If you ever change the
VAPID keys, browsers re-subscribe the next time SwasthID is opened.

## Where reminders work

- **Android** (Chrome, Edge, Firefox, Samsung Internet) and **desktop**
  browsers: yes, even with the browser closed on Android.
- **iPhone and iPad** (iOS 16.4 or later): only in the Home Screen app. Open
  SwasthID in Safari, tap Share, then Add to Home Screen, open it from there,
  and turn reminders on.

## Free plan limits

- The cron runs 1,440 times a day, well within the Workers free plan's
  100,000 requests a day.
- Each run reads one row per time zone in use, plus one per dose due at that
  minute. D1's free plan allows 5 million rows read a day.
- Each run has 10 ms of CPU time. Signing a push takes well under a
  millisecond, so hundreds of reminders a minute fit.

## Tests

```bash
npm test     # Node 22.13+; uses Node's built-in SQLite in place of D1
```

## API (called only by the SwasthID server)

Every request needs `Authorization: Bearer <SHARED_SECRET>`.

| Request | What it does |
| --- | --- |
| `PUT /subscriptions/:id` | Save a browser's endpoint, time zone and doses (`[{ time: "08:00", days: 127, monthDay?: 15 }]`). `:id` is the SHA-256 of the endpoint. Replaces what was there. |
| `DELETE /subscriptions/:id` | Forget a browser. |
| `POST /subscriptions/:id/test` | Send a push now. |
| `DELETE /users/:uid` | Forget every browser of an account. |
| `GET /health` | No secret needed. |

`days` is a bit mask of weekdays: bit 0 is Sunday, and 127 means every day.
