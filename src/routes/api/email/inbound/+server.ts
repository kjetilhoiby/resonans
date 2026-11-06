import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { readEmailWebhookToken, verifyEmailWebhookToken } from '$lib/server/email/auth';
import { CURRENT_SCRIPT_VERSION, INBOUND_SERVICE, parseInboundPayload } from '$lib/server/email/inbound';
import { processInboundEmail, resolveInboundUser } from '$lib/server/email/process-inbound';

/**
 * Gmail → Resonans. Postes av Apps Script-malen i
 * `$lib/server/email/apps-script-template.ts` (hentes fra /settings/sources).
 *
 * Statuskodene styrer scriptet: 2xx fjerner labelen, alt annet lar den stå så
 * meldingen prøves igjen (script v2 flytter den til «Resonans/Feilet» etter
 * gjentatte forsøk). Derfor er en ukjent mottaker 422, ikke 200 — fram til
 * november 2026 svarte endepunktet 200 og e-posten forsvant.
 *
 * Alle svar bærer `service`, så scriptet kan se at det faktisk snakker med
 * Resonans. Se `inbound.ts` for hvorfor.
 */

/** Uautentisert sjekk: scriptet sender ingenting før dette svaret er riktig. */
export const GET: RequestHandler = async () => {
	return json({ service: INBOUND_SERVICE, scriptVersion: CURRENT_SCRIPT_VERSION });
};

export const POST: RequestHandler = async ({ request, url }) => {
	const reply = (body: Record<string, unknown>, status = 200) =>
		json({ service: INBOUND_SERVICE, ...body }, { status });

	if (!verifyEmailWebhookToken(readEmailWebhookToken(request, url))) {
		return reply({ error: 'Unauthorized' }, 401);
	}

	let raw: Record<string, unknown>;
	try {
		raw = await request.json();
	} catch {
		return reply({ error: 'Invalid JSON' }, 400);
	}

	const payload = parseInboundPayload(raw);

	const user = await resolveInboundUser(payload);
	if (!user) {
		console.warn('[email-inbound] ukjent mottaker, label:', payload.Label ?? '(ingen)');
		return reply({ error: 'unknown_user', hint: 'Ingen Resonans-bruker med denne adressen.' }, 422);
	}

	const outcome = await processInboundEmail(user.id, payload, env.ORIGIN ?? url.origin);

	return reply(
		{
			success: outcome.status !== 'failed',
			status: outcome.status,
			duplicate: outcome.duplicate,
			handler: outcome.handler,
			rulesMatched: outcome.results.length,
			results: outcome.results.map((r) => ({ ruleName: r.ruleName, success: r.success })),
			label: payload.Label || undefined
		},
		outcome.status === 'failed' ? 500 : 200
	);
};
