import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listHunger, recordHunger } from '$lib/server/nutrition/hunger-log';
import { loadIntradayEnergy } from '$lib/server/nutrition/intraday';
import { predictHunger } from '$lib/domain/nutrition/hunger';

/**
 * Sultskalaen 1–5.
 *
 * Skrivingen bor i `recordHunger`, delt med chat-verktøyet `log_hunger`: gapet regnes
 * ut der, ikke i klienten, og de to inngangene kan derfor ikke bli uenige om hverken
 * tallet eller valideringen.
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
	const body = (await request.json().catch(() => null)) as {
		level?: unknown;
		note?: unknown;
	} | null;

	const result = await recordHunger({
		userId: locals.userId,
		level: body?.level as number,
		note: typeof body?.note === 'string' ? body.note : null
	});
	if (!result.ok) return json({ error: result.error }, { status: 400 });

	const { ok: _ok, ...payload } = result;
	return json(payload);
};
