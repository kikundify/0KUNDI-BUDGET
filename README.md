# Kikundify Budget — Capacitor App

Real project scaffold — not a template to copy pieces from, this is meant
to be your actual `kikundify-capacitor/` working folder.

## What's already decided (from our conversation)

- App ID: `com.kikundify.budget`
- Points at: `https://kikundify.com/budget-dashboard/`
- New keystore generated specifically for this app (not reused from your
  other two apps)
- Login uses WordPress's own built-in Application Passwords authorization
  screen — no custom login form to build, no password pasting

## Setup, in order

### 1. Prerequisites (one-time, on your build machine)
- Node.js (LTS version)
- Android Studio (includes the Android SDK and a JDK)

### 2. Install dependencies
```bash
cd kikundify-capacitor
npm install
```

### 3. Add the Android platform
```bash
npx cap add android
```

### 4. Add the login redirect handler to AndroidManifest.xml
Open `android/app/src/main/AndroidManifest.xml`, find the `<activity
android:name=".MainActivity">` block, and add the intent-filter from
`android-manifest-snippet/AndroidManifest-addition.xml` inside it
(alongside its existing intent-filter, not replacing it).

### 5. Sync and open in Android Studio
```bash
npx cap sync android
npx cap open android
```

### 6. Generate your signing keystore (new, specific to this app)
```bash
keytool -genkey -v -keystore kikundify-budget-release.keystore -alias kikundify-budget -keyalg RSA -keysize 2048 -validity 10000
```
**Back this file and its password up somewhere safe — losing it means you
can never update this app under the same Play Store listing again.**

Get its SHA256 fingerprint (needed for `assetlinks.json`):
```bash
keytool -list -v -keystore kikundify-budget-release.keystore -alias kikundify-budget
```

### 7. Test login on a real device
Run the app, tap whatever button you wire to `startLogin()` in `src/auth.js`.
It should open kikundify.com's login page in an in-app browser, let you log
in, ask you to approve "Kikundify Budget," then bounce back into the app.
Confirm `getStoredCredentials()` then returns your username + a generated
application password — check `wp-admin → Users → Profile → Application
Passwords` on your WordPress account afterward; you should see a new one
named "Kikundify Budget."

**Don't move to SMS capture until this login round-trip works reliably.**
Authentication is the foundation everything else sits on.

### 8. Only after login works: install the SMS plugin
```bash
npm install capacitor-sms-inbox
npx cap sync android
```
Add to `AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.READ_SMS" />
```

Then wire `src/sms-capture.js`'s exported functions (`requestSmsPermission`,
`backfillFromInbox`, `pollForNewMessages`) into your UI — a settings/
onboarding screen with a clear "Kikundify can automatically track your
M-Pesa transactions" explanation BEFORE the Android permission prompt (see
the disclosure requirement notes already in that file).

### 9. Validate the SMS regex patterns against REAL messages
Non-negotiable before shipping — see the detailed checklist in
`src/mpesa-sms-parser.js`'s header comment.

### 10. Google Play Permissions Declaration
Separate from all the above — do this in Play Console once you're ready
to submit, per the "SMS-based money management" exception we discussed.

## Files in this project

- `capacitor.config.json` — app identity + which URL it loads
- `src/auth.js` — real WordPress login via Application Passwords
- `src/mpesa-sms-parser.js` — regex parsing of M-Pesa SMS text
- `src/sms-capture.js` — permission request, backfill, polling, REST submission
- `android-manifest-snippet/` — the exact XML to add for the login redirect

## What's still a manual decision for you

- Whether `capacitor-sms-inbox` is the right plugin long-term, or a
  broadcast-listener-based alternative — check its current maintenance
  status before depending on it
- Where in your app's UI the "Log In" and "Enable M-Pesa Tracking" actions
  live — that's product/UX work, not something to guess at here
