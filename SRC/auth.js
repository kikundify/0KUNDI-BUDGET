/**
 * auth.js
 *
 * Implements WordPress core's built-in "Application Passwords" authorization
 * flow (available since WP 5.6 — no custom plugin needed for this part).
 * This is the correct way to get per-user API credentials into a mobile
 * app, rather than asking the user to paste anything manually.
 *
 * FLOW:
 *   1. App opens: https://kikundify.com/wp-admin/authorize-application.php
 *        ?app_name=Kikundify+Budget
 *        &success_url=kikundifybudget://auth-callback
 *   2. User logs in (if needed) on the real WordPress login page, then
 *      approves "Kikundify Budget" requesting access.
 *   3. WordPress redirects to success_url with the credentials as query
 *      params: ?site_url=...&user_login=...&password=...
 *   4. Android catches that custom-scheme redirect (via the intent-filter
 *      added to AndroidManifest.xml — see android-manifest-snippet/) and
 *      this module extracts + stores the credentials securely.
 *
 * SETUP REQUIRED:
 *   npm install @capacitor/browser @capacitor/app @capacitor/preferences
 *   Add the intent-filter from android-manifest-snippet/AndroidManifest-addition.xml
 *   to android/app/src/main/AndroidManifest.xml, inside <activity> for MainActivity.
 */

import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';

const SITE_URL = 'https://kikundify.com';
const APP_NAME = 'Kikundify Budget';
const CALLBACK_SCHEME = 'kikundifybudget://auth-callback';
const STORAGE_KEY = 'kb_wp_credentials';

/**
 * Kick off the login flow — opens WordPress's own authorization screen
 * in an in-app browser tab. Call this from a "Log In" button; the actual
 * credential storage happens later in handleAuthCallback(), triggered by
 * the redirect.
 */
export async function startLogin() {
	const authorizeUrl =
		`${SITE_URL}/wp-admin/authorize-application.php` +
		`?app_name=${encodeURIComponent( APP_NAME )}` +
		`&success_url=${encodeURIComponent( CALLBACK_SCHEME )}`;

	await Browser.open( { url: authorizeUrl } );
}

/**
 * Call this once, early in app startup, to listen for the redirect back
 * from WordPress after the user approves the app.
 */
export function registerAuthCallbackListener() {
	App.addListener( 'appUrlOpen', async ( data ) => {
		if ( ! data.url || ! data.url.startsWith( 'kikundifybudget://auth-callback' ) ) {
			return; // Not our callback — ignore.
		}

		await Browser.close().catch( () => {} ); // Close the in-app browser tab if still open.

		const parsed = new URL( data.url );
		const userLogin = parsed.searchParams.get( 'user_login' );
		const password = parsed.searchParams.get( 'password' );

		if ( ! userLogin || ! password ) {
			// eslint-disable-next-line no-console
			console.error( 'Auth callback missing expected params:', data.url );
			return;
		}

		await Preferences.set( {
			key: STORAGE_KEY,
			value: JSON.stringify( { username: userLogin, appPassword: password } ),
		} );

		// eslint-disable-next-line no-console
		console.log( 'Logged in as', userLogin );
		// Fire your own app event/state update here so the UI reflects "logged in."
	} );
}

/**
 * Retrieve stored credentials — this is what sms-capture.js's
 * submitTransaction() calls before hitting the REST endpoint.
 *
 * @returns {Promise<{ username: string, appPassword: string }|null>}
 */
export async function getStoredCredentials() {
	const result = await Preferences.get( { key: STORAGE_KEY } );
	if ( ! result.value ) {
		return null;
	}
	return JSON.parse( result.value );
}

/**
 * Log out — clears stored credentials. Note this does NOT revoke the
 * application password on the WordPress side; the user (or you, as
 * admin) would need to remove it from their WP profile's Application
 * Passwords list for a full revoke.
 */
export async function logout() {
	await Preferences.remove( { key: STORAGE_KEY } );
}
