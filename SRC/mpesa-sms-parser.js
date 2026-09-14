/**
 * mpesa-sms-parser.js
 *
 * Parses raw M-Pesa confirmation SMS text into structured transaction data.
 * This is pure logic with no Capacitor/Android dependency, so it can be
 * unit-tested on its own before wiring it to the SMS listener.
 *
 * IMPORTANT: Safaricom's SMS wording has changed over the years and can
 * vary slightly (spacing, punctuation, wording tweaks). Treat the patterns
 * below as a starting point — validate against a batch of REAL messages
 * from your users' phones before relying on this in production, and expect
 * to refine the regexes. A message that fails to match any pattern should
 * be logged (not silently dropped) so you can see what's slipping through.
 *
 * Common M-Pesa message types covered:
 *  - Send money (to a person)
 *  - Receive money (from a person)
 *  - Pay Bill payment
 *  - Buy Goods / Till payment
 *  - Withdraw (agent or ATM)
 *  - Airtime purchase
 */

/**
 * @typedef {Object} ParsedMpesaTransaction
 * @property {string} mpesaRef       e.g. "QAB1C2D3E4"
 * @property {'income'|'expense'} type
 * @property {number} amount
 * @property {string} counterparty   Who the money went to/came from
 * @property {string} txnDate        'YYYY-MM-DD HH:mm:ss'
 * @property {string} rawBody        Original SMS text, kept for debugging/audit
 */

const PATTERNS = [
	{
		// Send money: "QAB1C2D3E4 Confirmed. Ksh500.00 sent to JOHN DOE 0712345678 on 5/9/26 at 2:30 PM..."
		name: 'send_money',
		regex: /([A-Z0-9]{10})\s+Confirmed\.\s*Ksh([\d,]+\.\d{2})\s+sent to\s+(.+?)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+(\d{1,2}:\d{2}\s?[AP]M)/i,
		type: 'expense',
	},
	{
		// Receive money: "QAB1C2D3E4 Confirmed. You have received Ksh1,000.00 from JANE DOE 0712345678 on 5/9/26 at 2:30 PM..."
		name: 'receive_money',
		regex: /([A-Z0-9]{10})\s+Confirmed\.\s*You have received\s+Ksh([\d,]+\.\d{2})\s+from\s+(.+?)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+(\d{1,2}:\d{2}\s?[AP]M)/i,
		type: 'income',
	},
	{
		// Pay Bill: "QAB1C2D3E4 Confirmed. Ksh2,500.00 paid to KPLC PREPAID for account 12345678 on 5/9/26 at 2:30 PM..."
		name: 'paybill',
		regex: /([A-Z0-9]{10})\s+Confirmed\.\s*Ksh([\d,]+\.\d{2})\s+paid to\s+(.+?)\s+for account/i,
		type: 'expense',
	},
	{
		// Buy Goods / Till: "QAB1C2D3E4 Confirmed. Ksh300.00 paid to NAIVAS SUPERMARKET on 5/9/26 at 2:30 PM..."
		name: 'buy_goods',
		regex: /([A-Z0-9]{10})\s+Confirmed\.\s*Ksh([\d,]+\.\d{2})\s+paid to\s+(.+?)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+(\d{1,2}:\d{2}\s?[AP]M)/i,
		type: 'expense',
	},
	{
		// Withdraw: "QAB1C2D3E4 Confirmed. Ksh2,000.00 withdrawn from ... on 5/9/26 at 2:30 PM..."
		name: 'withdraw',
		regex: /([A-Z0-9]{10})\s+Confirmed\.\s*Ksh([\d,]+\.\d{2})\s+withdrawn from\s+(.+?)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+(\d{1,2}:\d{2}\s?[AP]M)/i,
		type: 'expense',
	},
	{
		// Airtime: "QAB1C2D3E4 Confirmed. You bought Ksh100.00 of airtime on 5/9/26 at 2:30 PM..."
		name: 'airtime',
		regex: /([A-Z0-9]{10})\s+Confirmed\.\s*You bought\s+Ksh([\d,]+\.\d{2})\s+of airtime/i,
		type: 'expense',
	},
];

/**
 * Convert M-Pesa's "5/9/26" + "2:30 PM" into 'YYYY-MM-DD HH:mm:ss'.
 * Falls back to "now" if date parts are missing (better than dropping the transaction).
 */
function buildTxnDate( dateStr, timeStr ) {
	if ( ! dateStr ) {
		return new Date().toISOString().slice( 0, 19 ).replace( 'T', ' ' );
	}

	const [ day, month, yearRaw ] = dateStr.split( '/' );
	const year = yearRaw.length === 2 ? '20' + yearRaw : yearRaw;

	let hours = 0;
	let minutes = 0;
	if ( timeStr ) {
		const match = timeStr.match( /(\d{1,2}):(\d{2})\s?([AP]M)/i );
		if ( match ) {
			hours = parseInt( match[1], 10 );
			minutes = parseInt( match[2], 10 );
			const period = match[3].toUpperCase();
			if ( period === 'PM' && hours !== 12 ) hours += 12;
			if ( period === 'AM' && hours === 12 ) hours = 0;
		}
	}

	const pad = ( n ) => String( n ).padStart( 2, '0' );
	return `${year}-${pad( month )}-${pad( day )} ${pad( hours )}:${pad( minutes )}:00`;
}

/**
 * Parse a single SMS body into a structured transaction, or null if it
 * doesn't match a known M-Pesa pattern (e.g. it's not an M-Pesa message,
 * or it's a format we haven't covered yet).
 *
 * @param {string} smsBody
 * @returns {ParsedMpesaTransaction|null}
 */
function parseMpesaSms( smsBody ) {
	if ( ! smsBody || typeof smsBody !== 'string' ) {
		return null;
	}

	for ( const pattern of PATTERNS ) {
		const match = smsBody.match( pattern.regex );
		if ( match ) {
			const [ , mpesaRef, amountStr, counterparty, dateStr, timeStr ] = match;
			return {
				mpesaRef: mpesaRef.trim(),
				type: pattern.type,
				amount: parseFloat( amountStr.replace( /,/g, '' ) ),
				counterparty: ( counterparty || '' ).trim(),
				txnDate: buildTxnDate( dateStr, timeStr ),
				rawBody: smsBody,
				matchedPattern: pattern.name,
			};
		}
	}

	return null; // Caller should log unmatched messages for later regex tuning.
}

module.exports = { parseMpesaSms };
