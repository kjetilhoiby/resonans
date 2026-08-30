import { error, json } from '@sveltejs/kit';
import { setSavingsRole } from '$lib/server/economics/account-settings';
import type { RequestHandler } from './$types';

/**
 * PUT /api/economics/sparing/kontoer
 *
 * Setter om en konto regnes som buffer: `{ accountId, role }` der role er `auto` (la
 * heuristikken bestemme), `buffer` (alltid med) eller `ignore` (alltid ute). Se
 * `docs/changelog/2026-08-12-velge-bufferkontoer.md`.
 *
 * Skriver gjennom `setSavingsRole` og ikke mot tabellen direkte, så valideringen bor på ett
 * sted — samme regel som `saveNutritionTargets`.
 *
 * Én konto per kall, med vilje: kontovelgeren er en rad man trykker på, og et batch-kall
 * ville krevd at flaten holdt en hel tilstand for å sende den. Da kan to faner overskrive
 * hverandres valg.
 */
export const PUT: RequestHandler = async ({ locals, request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Forventet JSON med accountId og role.');
	}

	const { accountId, role } = (body ?? {}) as { accountId?: unknown; role?: unknown };
	const result = await setSavingsRole(
		locals.userId,
		typeof accountId === 'string' ? accountId : '',
		role
	);

	// Meldingen returneres som tekst klienten kan VISE. En 400 uten forklaring ser ut som en
	// feil i flaten framfor en ugyldig verdi.
	if (!result.ok) error(400, result.error);

	return json({ accountId: result.accountId, role: result.role });
};
