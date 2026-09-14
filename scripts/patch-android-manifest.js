/**
 * patch-android-manifest.js
 *
 * The android/ folder is generated fresh by `npx cap add android` each CI
 * run (it's not committed to the repo), so any manual edit we'd normally
 * make by hand in Android Studio needs to happen here instead, as an
 * automated step, every time.
 *
 * This adds the login-callback intent-filter (for src/auth.js's
 * WordPress Application Passwords redirect) to MainActivity. It's
 * idempotent — safe to run even if already patched.
 */
const fs = require( 'fs' );

const MANIFEST_PATH = 'android/app/src/main/AndroidManifest.xml';
const MARKER = 'kikundifybudget'; // Used to detect "already patched."

const INTENT_FILTER = `
        <intent-filter>
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.DEFAULT" />
            <category android:name="android.intent.category.BROWSABLE" />
            <data android:scheme="kikundifybudget" android:host="auth-callback" />
        </intent-filter>`;

let manifest = fs.readFileSync( MANIFEST_PATH, 'utf8' );

if ( manifest.includes( MARKER ) ) {
	console.log( 'AndroidManifest.xml already patched — skipping.' );
	process.exit( 0 );
}

// Insert just before the first </activity> closing tag, which — right
// after `cap add android` with no other activities added — is
// MainActivity's. If you later add other activities above it, double
// check this still targets the right one.
const closingTag = '</activity>';
const index = manifest.indexOf( closingTag );

if ( index === -1 ) {
	console.error( 'Could not find </activity> in AndroidManifest.xml — manual patch needed.' );
	process.exit( 1 );
}

manifest = manifest.slice( 0, index ) + INTENT_FILTER + '\n    ' + manifest.slice( index );

fs.writeFileSync( MANIFEST_PATH, manifest );
console.log( 'AndroidManifest.xml patched with login-callback intent-filter.' );
