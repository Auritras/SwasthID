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
  refill reminders, dose notifications and a calendar file for reminders when
  the app is closed.
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
- Light and dark mode, and layouts for phones and desktops.

## How it is built

```
Browser ──────────────► SwasthID server (Node, SwasthID-Render/)
  │  HTML, CSS, JS          │  serves the app and small JSON APIs
  │                         ├──► Firebase Admin (emergency QRs, doctor links,
  │                         │     account deletion)
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
  firebase-config.js        Firebase web config (safe to be public)
  firestore.rules           Firestore security rules
  sw.js                     Service worker, only for dose notifications
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
      dose-reminders.js       Notifications and calendar export
      pdf-kit.js              Shared PDF drawing helpers
      pdf-builders.js         Emergency card and health summary PDFs
      vitals.js               Vitals log and charts
    favicon.svg, icon-*.png, og-image.png, site.webmanifest
SwasthID-Risk-API/          FastAPI service for the PREVENT equations
```

The scripts are ordinary `<script>` tags that share one global scope, so their
order in `index.html` matters: a file can use anything defined in an earlier
file.

## Running it locally

You need Node 18 or newer.

```bash
cd SwasthID-Render
npm install
npm start
```

Open http://localhost:10000. It signs in with the Firebase project in
`firebase-config.js`. To try it without Firebase, set that file to
`window.SWASTH_FIREBASE_CONFIG = {};` and the app runs in local demo mode,
keeping everything in the browser.

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
| `PUBLIC_BASE_URL` | The site's public address, used in share and QR links. Defaults to the address of the request. |
| `ALLOWED_ORIGIN` | CORS origin for the API. Default `*`. |
| `OVERPASS_URLS` | Comma-separated Overpass servers for Nearby care, if you want to override the defaults. |
| `PORT` | Port to listen on. Default 10000; Render sets this for you. |

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

## Privacy and security

- Firestore rules limit every account to its own data.
- The emergency QR carries an encrypted token, not your data. It shows only
  what you choose, keeps an access log, and stops working when you revoke it.
- Doctor links are read-only, expire within 24 hours and can be revoked.
- Scanning, OCR and SwasthAI run in the browser; images and questions are not
  uploaded.
- **Delete my account and data** (Account → Profile) removes your Firestore
  data, your sign-in and any active QR or doctor link.
