import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listHunger, logHunger } from '$lib/server/nutrition/hunger-log';
import { loadIntradayEnergy } from '$lib/server/nutrition/intraday';
import { isHungerLevel, predictHunger } from '$lib/domain/nutrition/hunger';
import { osloHourNow } from '$lib/domain/nutrition/intake-pacing';

/**
 * Sultskalaen 1–5.
 *
 * Gapet regnes ut **her**, ikke i klienten: det er det ene tallet meldingen får verdi
 * av, og en klient som sender sitt eget gap kunne sendt hva som helst. Samme loader
 * som flaten og nudgen bruker, så de tre er enige om tallet.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const [history, intraday] = await Promise.all([
		listHunger(locals.userId),
		loadIntradayEnergy(locals.userId)
	]);
	return json({
		history: history.slice(0, 30),
		prediction: predictHunger({ history, gapNowKcal: intraday?.gapNow ?? null })
	});
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => null);
	const level = (body as { level?: unknown } | null)?.level;
	if (!isHungerLevel(level)) {
		return json({ error: 'Sultnivå må være et helt tall mellom 1 og 5.' }, { status: 400 });
	}

	const intraday = await loadIntradayEnergy(locals.userId);
	const created = await logHunger({
		userId: locals.userId,
		level,
		gapKcal: intraday?.gapNow ?? null,
		intakeKcal: intraday?.intakeNow ?? null,
		osloHour: osloHourNow(),
		note: typeof (body as { note?: unknown }).note === 'string' ? (body as { note: string }).note : null
	});
	if (!created) return json({ error: 'Kunne ikke lagre sultmeldingen.' }, { status: 400 });

	const history = await listHunger(locals.userId);
	return json({
		...created,
		gapKcal: intraday?.gapNow ?? null,
		/** Modellen etter denne meldingen — så flaten kan si at den lærte noe. */
		prediction: predictHunger({ history, gapNowKcal: intraday?.gapNow ?? null })
	});
};
