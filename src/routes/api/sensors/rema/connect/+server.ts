import { json, error } from '@sveltejs/kit';
import { parseRemaCallbackInput } from '$lib/domains/food/rema-receipts';
import { exchangeRemaCode, RemaHttpError } from '$lib/server/integrations/rema';
import {
	clearRemaPkce,
	normalizeMobileNumber,
	readRemaPkce,
	storeRemaConnection
} from '$lib/server/integrations/rema-connect';
import type { RequestHandler } from './$types';

/**
 * POST /api/sensors/rema/connect
 * Body: { callback: string; mobileNumber?: string }
 *
 * `callback` er adressen brukeren havnet på etter innloggingen
 * (`https://ae-appen.appspot.com/…?code=…`, `bella://authorize?code=…`) eller
 * bare koden. Byttes mot tokens med verifikatoren fra `connect/start`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const userId = locals.userId;
	if (!userId) throw error(401, 'Ikke innlogget');

	let body: { callback?: unknown; mobileNumber?: unknown };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Ugyldig forespørsel');
	}

	const parsed = parseRemaCallbackInput(typeof body.callback === 'string' ? body.callback : '');
	if (!parsed.ok) throw error(400, parsed.reason);

	const mobile = normalizeMobileNumber(body.mobileNumber);
	if (!mobile.ok) throw error(400, 'Mobilnummeret ser ikke ut som et telefonnummer (8–15 sifre).');

	const pkce = readRemaPkce(cookies);
	if (!pkce) {
		throw error(400, 'Innloggingen er for gammel eller ble startet i en annen nettleser. Trykk «Logg inn hos Rema» på nytt.');
	}
	if (parsed.state && parsed.state !== pkce.state) {
		throw error(400, 'Adressen hører til en annen innlogging. Trykk «Logg inn hos Rema» på nytt.');
	}

	let token;
	try {
		token = await exchangeRemaCode(parsed.code, pkce.verifier);
	} catch (err) {
		const status = err instanceof RemaHttpError ? err.status : 0;
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[rema] kodebytte feilet status=${status}: ${message}`);
		// En kode kan bare brukes én gang — er Æ-appen installert, kan den ha
		// tatt den først. Det er det vanligste utfallet av en 400 her.
		throw error(
			502,
			status === 400 || status === 401
				? 'Rema avviste koden. Den kan bare brukes én gang og varer kort — start innloggingen på nytt, gjerne i en nettleser på en maskin uten Æ-appen.'
				: `Rema svarte ikke som ventet: ${message}`
		);
	}

	clearRemaPkce(cookies);
	await storeRemaConnection(userId, token, mobile.value);
	return json({ success: true, message: 'Rema 1000 koblet til.' });
};
