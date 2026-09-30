# SwasthID

Your health record, medicines and emergency card in one private place.

SwasthID is a web app for keeping track of your own health: the medicines you
take and when, your conditions and allergies, lab results and vitals over time,
and an emergency card that a paramedic can scan. It runs in the browser on a
phone or a computer, and everything is stored in your own account.

> SwasthID gives information, not medical advice. Always check with a qualified
> clinician.

## What it does

- **Today's medicines.** Doses by time of day, "Mark taken", overdue flags,
  refill reminders and a calendar file.
- **Dose reminders, even when the app is closed.** A notification at each
  dose time, naming the medicines due and skipping any already taken. It
  works on Android and desktop browsers, and on iPhone from the Home Screen
  app (see [Reminders when the app is closed](#reminders-when-the-app-is-closed)).
- **Records.** Conditions, doctor visits, prescriptions and lab reports, with a
  timeline and day-by-day tabs for doses and meals.
- **Scan prescriptions and lab reports.** Text is read from a photo or PDF in
  your browser (Tesseract.js); you check every field before it is saved. Lab
  values feed trend charts (HbA1c, lipids, kidney function and more).
- **Vitals.** Blood pressure, blood sugar, weight and SpO₂ with adult
  reference ranges and trend charts.
- **Nutrition.** Food search (Indian IFCT 2017 and USDA data), barcode lookup,
  water and calorie targets, and warnings for common medicine–food
  interactions.
- **Heart risk.** 10-year cardiovascular risk from the American Heart
  Association's PREVENT equations (adults 30–79).
- **Find medicines.** Compare pack sizes and reference prices, then open the
  search results for that medicine on Tata 1mg, PharmEasy or Apollo Pharmacy.
- **Nearby care.** Hospitals, clinics, doctors and pharmacies around you,
  including Jan Aushadhi and other generic-medicine stores, from OpenStreetMap.
- **Emergency card.** A QR code that shows your blood group, allergies,
  conditions, medicines and emergency contact to whoever scans it. The data in
  the QR link is encrypted, you choose what it shows, and you can revoke it.
  Download it as a PDF with a cut-out wallet card.
- **Share with a doctor.** A read-only link to your health summary that
  expires within 24 hours, with an access log, or a printable summary PDF.
- **Family.** Keep track of people you look after.
- **SwasthAI.** An optional assistant that runs entirely in your browser
  (WebLLM); nothing you ask it leaves your device.
- **Works offline and installs like an app.** After one visit, SwasthID opens
  without a connection and shows what is saved on the device. Install it from
  the account menu (**Install app**), or on an iPhone with Share → Add to Home
  Screen.
- **Account emails in SwasthID's own style.** Password reset and email
  confirmation emails are sent by the server and open a SwasthID page to set
  the new password or confirm the address (see [Account emails](#account-emails)).
- Light and dark mode, and layouts for phones and desktops.

## How it is built

```
Browser ──────────────► SwasthID server (Node, SwasthID-Render/)
  │  HTML, CSS, JS          │  serves the app and small JSON APIs
  │                         ├──► Firebase Admin (emergency QRs, doctor links,
  │                         │     account deletion, account email links)
  │                         ├──► SMTP (password reset and confirmation emails)
  │                         ├──► Reminder Worker (Cloudflare, SwasthID-Push-Worker/)
  │                         │     └──► every minute: Web Push to phones with a dose due
  │                         ├──► Risk API (Python, SwasthID-Risk-API/)
  │                         ├──► OpenStreetMap Overpass (nearby care)
  │                         └──► DrugSetu (medicine search, optional)
  │
  └──► Firebase Auth + Firestore (your account and records, protected by
       firestore.rules)
```

There is no build step and no framework: the app is plain HTML, CSS and
JavaScript, served as-is.

### Folder layout

```
SwasthID-Render/            The web app and its Node server
  index.html                Page markup (screens, dialogs, icon sprite)
  server.js                 HTTP server: static files and /api/* routes
  mail.js                   Account emails: SMTP sending and the two templates
  auth-action.html          Page the email links open (new password, confirm email)
  firebase-config.js        Firebase web config (safe to be public)
  firestore.rules           Firestore security rules
  sw.js                     Service worker: offline copy of the app, dose reminder pushes
  playwright.config.js      Browser test setup
  tests/                    server/ (API tests), e2e/ (browser), emulator/ (accounts)
  assets/
    app.css                 Design system: tokens, components, screens
    legacy.css              Older styles still used by a few screens
    js/                     One file per feature, loaded in this order:
      loader.js               Loads Tesseract, pdf.js and the QR library on demand
      firebase-config-fallback.js
      cloud-sync.js           Firebase sign-in, Firestore sync and retries
      auth-and-navigation.js  Log in, sign up, session, tabs and menus
      dashboard.js            Greeting, today's stats, mood check-in
      medications.js          Medicine schedule, "Mark taken", adherence
      risk-gauge.js           Heart risk result display
      food-log.js             Food search and calorie logging
      prescription-scan.js    Prescription OCR and review
      personalized-ui.js      Profile-driven panels, profile photo
      records.js              Records, timeline, lab reports and trends
      medicine-search.js      Find medicines and pharmacy links
      nearby.js               Nearby care search
      emergency.js            Emergency card and QR
      assistant.js            SwasthAI
      daily-reset.js          Midnight reset of daily counters
      profile-editor.js       Profile dialog
      nutrition-extras.js     Weekly trends, food interactions, barcodes
      profile-wizard.js       Step-by-step profile setup
      dose-reminders.js       Reminders (push or in-app) and calendar export
      pdf-kit.js              Shared PDF drawing helpers
      pdf-builders.js         Emergency card and health summary PDFs
      vitals.js               Vitals log and charts
      pwa.js                  Offline service worker and "Install app"
      auth-action.js          Script for auth-action.html (not part of the app page)
    favicon.svg, icon-*.png, og-image.png, site.webmanifest
SwasthID-Push-Worker/       Cloudflare Worker that sends dose reminders (own README)
  src/index.js              API for the server, and the every-minute check
  src/webpush.js            Signed (VAPID) pushes
  schema.sql                D1 database tables
SwasthID-Risk-API/          FastAPI service for the PREVENT equations
  test_api.py               Its tests
.github/workflows/ci.yml    Runs every test on each pull request
```

The scripts are ordinary `<script>` tags that share one global scope, so their
order in `index.html` matters: a file can use anything defined in an earlier
file.

## Running it locally

You need Node 20 or newer.

```bash
cd SwasthID-Render
npm install
npm start
```

Open http://localhost:10000. It signs in with the Firebase project in
`firebase-config.js`. To try it without Firebase, start it with
`DEMO_MODE=1 npm start`: the app runs in local demo mode and keeps everything
in the browser.

Features that need the server's secrets (emergency QR, doctor links, account
deletion, heart risk, live medicine search) stay switched off until the
matching environment variables below are set. `GET /health` shows which ones
are on.

To run the heart risk service as well:

```bash
cd SwasthID-Risk-API
pip install -r requirements.txt
uvicorn main:app --port 8001
```

Then start the Node server with `RISK_API_URL=http://localhost:8001`.

## Tests

Every pull request runs all of these on GitHub Actions
(`.github/workflows/ci.yml`). To run them yourself:

```bash
cd SwasthID-Render
npm install
npx playwright install chromium   # once

npm test                 # server and API tests
npm run test:e2e         # the app in a browser, in demo mode
npm run test:emulator    # accounts, sync, security rules and deletion
                         # (needs Java; starts the Firebase emulators itself)

cd ../SwasthID-Push-Worker
npm test                 # reminder Worker (Node 22.13+)

cd ../SwasthID-Risk-API
pip install -r requirements-dev.txt
pytest                   # heart risk API
```

The browser tests never contact real outside services: map servers, food and
medicine APIs are blocked or faked. The emulator tests use a throwaway
`demo-swasthid` project and your real `firestore.rules`, so they never touch
your live Firebase data.

## Configuration

All settings are environment variables on the Node server. None are needed to
start it.

| Variable | What it does |
| --- | --- |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Service account for Firebase Admin. Needed to keep emergency QRs and doctor links across restarts, and for account deletion. Without them, links are kept in memory and reset when the server restarts. |
| `EMERGENCY_SECRET` | Long random string used to encrypt emergency QR tokens. Emergency QRs are off without it. |
| `EMERGENCY_TTL_DAYS` | How long an emergency QR stays valid. Default 180, maximum 730. |
| `RISK_API_URL` | Base URL of the Risk API, e.g. `https://swasthid-risk.onrender.com`. Heart risk is off without it. |
| `DRUGSETU_API_KEY` | Key for live medicine search. Without it, Find medicines uses the built-in reference catalogue. |
| `PUBLIC_BASE_URL` | The site's public address, used in share and QR links. Defaults to the address of the request. Links in account emails use it, or Render's `RENDER_EXTERNAL_URL`, and never the request's address. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Mail account that sends password reset and confirmation emails (see [Account emails](#account-emails)). Without them, Firebase sends its default emails. `SMTP_PORT` defaults to 587; `SMTP_SECURE=1` forces TLS from the start (port 465 does this by itself). |
| `PUSH_WORKER_URL`, `PUSH_WORKER_SECRET`, `VAPID_PUBLIC_KEY` | The reminder Worker's address, its shared secret and the public VAPID key (see [Reminders when the app is closed](#reminders-when-the-app-is-closed)). Without them, reminders come only while SwasthID is open. |
| `ALLOWED_ORIGIN` | CORS origin for the API. Default `*`. |
| `OVERPASS_URLS` | Comma-separated Overpass servers for Nearby care, if you want to override the defaults. |
| `PORT` | Port to listen on. Default 10000; Render sets this for you. |
| `DEMO_MODE` | `1` runs the app without Firebase, keeping data in the browser. For trying it out; never set it on the live site. |

## Setting up Firebase

1. Create a Firebase project and add a web app. Put its config in
   `SwasthID-Render/firebase-config.js`, and in
   `SwasthID-Render/assets/js/firebase-config-fallback.js`, which is used
   when the first file can't be loaded.
2. In **Authentication**, turn on **Email/Password** and **Google**, and add
   your site's domain under **Authorized domains**.
3. Create a **Firestore** database, then publish the rules in
   `SwasthID-Render/firestore.rules` (Firestore → Rules). Each user can only
   read and write their own `users/{uid}` document and its `entries`.
4. In **Project settings → Service accounts**, generate a private key and copy
   its `project_id`, `client_email` and `private_key` into the three
   `FIREBASE_*` variables. Keep the `\n` sequences in the private key as they
   are.

Everything above works on Firebase's free Spark plan. Profile photos are
shrunk to a few KB and stored in Firestore, so Firebase Storage is not needed.

## Account emails

Firebase's own reset and confirmation emails can't be restyled, so the server
sends its own. Firebase still makes the one-time codes and checks them; the
email links open `/auth/action` on your site, where the user picks a new
password or sees their address confirmed. Any free SMTP account works:

- **Gmail.** Turn on 2-Step Verification for the Google account, then create
  an app password at <https://myaccount.google.com/apppasswords>. Set
  `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER` to the Gmail
  address, `SMTP_PASS` to the 16-letter app password, and
  `MAIL_FROM="SwasthID <that address>"`. Gmail allows about 500 emails a day.
- **Brevo** (free plan, 300 emails a day). Add and confirm a sender address,
  then under **SMTP & API** create an SMTP key. Set `SMTP_HOST=smtp-relay.brevo.com`,
  `SMTP_PORT=587`, `SMTP_USER` to the login shown there, `SMTP_PASS` to the
  key, and `MAIL_FROM` to the confirmed sender.

On Render, `RENDER_EXTERNAL_URL` gives the links your site's address; on any
other host set `PUBLIC_BASE_URL`. `/health` shows `accountEmails: true` once
SMTP is set. If sending ever fails, the app falls back to Firebase's email, so
people can always reset their password. Resets are limited to 3 an hour per
address and 10 per 15 minutes per visitor, and the reply is the same whether
or not an account exists.

## Reminders when the app is closed

A free Render server sleeps when idle, so it can't send a reminder at 8:00.
A small Cloudflare Worker on the free plan (`SwasthID-Push-Worker/`) does
instead. It wakes every minute and sends a Web Push to each phone with a dose
due. The Worker is given only dose times, weekdays and the time zone. The
notification's medicine names come from a copy of the schedule kept on the
phone, and doses already marked taken are left out.

Setup takes about 10 minutes: follow
[SwasthID-Push-Worker/README.md](SwasthID-Push-Worker/README.md), then set
`PUSH_WORKER_URL`, `PUSH_WORKER_SECRET` and `VAPID_PUBLIC_KEY` on the Node
service. Anyone who already had reminders on switches over the next time they
open SwasthID while logged in. Without the Worker, reminders still work while
SwasthID is open, and the calendar file covers the rest.

## Deploying on Render

Create two **Web Services** from this repository:

| | SwasthID (Node) | Risk API (Python) |
| --- | --- | --- |
| Root directory | `SwasthID-Render` | `SwasthID-Risk-API` |
| Build command | `npm install` | `pip install -r requirements.txt` |
| Start command | `npm start` | `uvicorn main:app --host 0.0.0.0 --port $PORT` |

Set the environment variables on the Node service, with `RISK_API_URL` pointing
at the Risk API service. After a deploy, `/health` shows the running commit
(`version`) and which features are configured.

## Free services it relies on

SwasthID uses only free services and libraries:

- **Firebase** Authentication and Firestore (Spark plan)
- **OpenStreetMap** data through the public Overpass servers (overpass-api.de,
  overpass.private.coffee, maps.mail.ru) for Nearby care
- **Open Food Facts** for barcodes, **USDA FoodData Central** (demo key) and
  a built-in selection of **IFCT 2017** values for food
- **ipwho.is** for an approximate location when the browser can't provide one
- **Tesseract.js**, **pdf.js**, **jsPDF**, **qrcodejs**, **ZXing** and
  **WebLLM**, loaded from public CDNs only when a feature needs them
- **Lexend** from Google Fonts
- **Gmail** (app password) or **Brevo**'s free plan for account emails, if you
  set one up
- **Cloudflare Workers** and **D1** (free plan) for reminders when the app is
  closed, and the browsers' own push services (Google, Mozilla, Apple), which
  are free

## Privacy and security

- Firestore rules limit every account to its own data.
- The emergency QR carries an encrypted token, not your data. It shows only
  what you choose, keeps an access log, and stops working when you revoke it.
- Doctor links are read-only, expire within 24 hours and can be revoked.
- Scanning, OCR and SwasthAI run in the browser; images and questions are not
  uploaded.
- The reminder Worker stores dose times, weekdays and the time zone, never
  medicine names. Turning reminders off, logging out or deleting the account
  removes them.
- **Delete my account and data** (Account → Profile) removes your Firestore
  data, your sign-in, your reminders and any active QR or doctor link.
