/**
 * sms-capture.js
 *
 * Wires the M-Pesa SMS parser to:
 *  1. Android's SMS inbox, via a Capacitor community plugin (capacitor-sms-inbox
 *     or @jonz94/capacitor-read-sms — pick one; API shapes below assume
 *     capacitor-sms-inbox, adjust if you choose the other).
 *  2. The Kikundify Budget REST endpoint built into the WordPress plugin
 *     (POST /wp-json/kikundify-budget/v1/transactions/import).
 *
 * SETUP REQUIRED BEFORE THIS RUNS:
 *   npm install capacitor-sms-inbox
 *   npx cap sync android
 *   Add to android/app/src/main/AndroidManifest.xml:
 *     <uses-permission android:name="android.permission.READ_SMS" />
 *
 * AUTH REQUIRED:
 *   Generate a WordPress Application Password for the logged-in user
 *   (Users > Profile > Application Passwords in wp-admin) and store it
 *   securely on-device (Capacitor Preferences/Secure Storage) — do NOT
 *   hardcode it. This module expects it to already be available via
 *   getStoredCredentials().
 *
 * PLAY STORE POLICY REMINDER:
 *   Before shipping this, confirm your app qualifies under Google Play's
 *   current Permissions Declaration Form for READ_SMS/RECEIVE_SMS as a
 *   financial transaction-logging app. This is a policy review to do
 *   BEFORE submitting, not an engineering task — Play can reject or pull
 *   an app that doesn't clearly qualify.
 */

import { SmsInbox } from 'capacitor-sms-inbox'; // Adjust import to match your chosen plugin's actual export name.
import { parseMpesaSms } from './mpesa-sms-parser';
import { getStoredCredentials } from './auth'; // Real implementation — see auth.js.

const API_BASE_URL = 'https://kikundify.com/wp-json/kikundify-budget/v1';
const MPESA_SENDER = 'MPESA'; // Confirm the exact sender ID/address Safaricom uses on your test devices — this can vary.

/**
 * PLAY STORE POLICY REMINDER:
 *   Before shipping this, confirm your app qualifies under Google Play's
 *   current Permissions Declaration Form for READ_SMS/RECEIVE_SMS as a
 *   financial transaction-logging app. This is a policy review to do
 *   BEFORE submitting, not an engineering task — Play can reject or pull
 *   an app that doesn't clearly qualify.
 */

/**
 * Request SMS read permission from the user. Call this from a clear,
 * explained UI moment (e.g. an onboarding screen: "Kikundify Budget can
 * automatically log your M-Pesa transactions — allow SMS access?") —
 * never request it silently on app launch, both for UX and because Play
 * reviewers check for a clear in-context permission rationale.
 *
 * @returns {Promise<boolean>} true if granted
 */
export async function requestSmsPermission() {
	const status = await SmsInbox.requestPermissions();
	return status.sms === 'granted';
}

/**
 * Submit one parsed transaction to the WordPress REST endpoint.
 *
 * @param {import('./mpesa-sms-parser').ParsedMpesaTransaction} txn
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
async function submitTransaction( txn ) {
	const creds = await getStoredCredentials();
	if ( ! creds ) {
		throw new Error( 'No stored WordPress credentials — user must be logged in.' );
	}

	const basicAuth = btoa( `${creds.username}:${creds.appPassword}` );

	const response = await fetch( `${API_BASE_URL}/transactions/import`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Basic ${basicAuth}`,
		},
		body: JSON.stringify( {
			amount: txn.amount,
			type: txn.type,
			txn_date: txn.txnDate,
			mpesa_ref: txn.mpesaRef,
			counterparty: txn.counterparty,
			memo: txn.matchedPattern,
		} ),
	} );

	const data = await response.json();

	// The REST endpoint returns success:true even for duplicates (HTTP 200) —
	// see kb_rest_import_transaction() in the WP plugin. Treat non-2xx as a
	// real failure worth retrying/logging.
	if ( ! response.ok && response.status !== 200 ) {
		return { success: false, message: data.message || 'Unknown error' };
	}

	return { success: true, message: data.message };
}

/**
 * One-time backfill: read existing SMS inbox messages from the M-Pesa
 * sender and import any that parse successfully. Good for onboarding —
 * gives the user instant historical data instead of starting from zero.
 *
 * @param {number} maxMessages Safety cap so this doesn't try to import years of history in one call.
 */
export async function backfillFromInbox( maxMessages = 500 ) {
	const granted = await requestSmsPermission();
	if ( ! granted ) {
		throw new Error( 'SMS permission not granted.' );
	}

	const { smsList } = await SmsInbox.getSMSList( {
		filter: { address: MPESA_SENDER, maxCount: maxMessages },
	} );

	const results = { imported: 0, skipped: 0, unmatched: 0 };

	for ( const sms of smsList ) {
		const parsed = parseMpesaSms( sms.body );
		if ( ! parsed ) {
			results.unmatched++;
			// eslint-disable-next-line no-console
			console.warn( 'Unmatched M-Pesa SMS format — needs a new regex pattern:', sms.body );
			continue;
		}

		try {
			const outcome = await submitTransaction( parsed );
			outcome.success ? results.imported++ : results.skipped++;
		} catch ( err ) {
			results.skipped++;
			// eslint-disable-next-line no-console
			console.error( 'Failed to submit transaction:', err );
		}
	}

	return results;
}

/**
 * Live listener: call this once on app start (after permission is granted)
 * to catch new M-Pesa SMS as they arrive, without the user reopening the
 * inbox screen.
 *
 * NOTE: capacitor-sms-inbox as documented is a pull API (getSMSList), not a
 * push/broadcast listener. For true real-time capture as messages arrive,
 * you likely need a plugin that wraps Android's BroadcastReceiver for
 * SMS_RECEIVED — confirm this against whichever plugin you settle on;
 * some community plugins only support polling on app foreground, which
 * means transactions show up when the user opens the app, not instantly.
 * Verify this behavior before promising "real-time" to users.
 */
export async function pollForNewMessages( sinceTimestamp ) {
	const { smsList } = await SmsInbox.getSMSList( {
		filter: { address: MPESA_SENDER, minDate: sinceTimestamp },
	} );

	for ( const sms of smsList ) {
		const parsed = parseMpesaSms( sms.body );
		if ( parsed ) {
			await submitTransaction( parsed );
		}
	}

	return smsList.length;
}
