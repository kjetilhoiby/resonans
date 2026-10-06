/**
 * POST   /api/apps/akser/timeline          — 1–31 dager, hver erstatter det som lå der
 * DELETE /api/apps/akser/timeline?date=…   — slett én dag
 * DELETE /api/apps/akser/timeline?all=true — slett hele tidslinjen og alle stedene
 *
 * Kontrakten står i `docs/akser-tidslinje.md`, valideringen i
 * `$lib/domain/movement/timeline.ts`, lagringen i `$lib/server/movement/akser-store.ts`.
 *
 * Svaret har ett resultat per dag: én dårlig dag stopper ikke de andre. Avviste
 * dager skrives i `lastError` på sensoren, så monitoreringen ser dem — en app som
 * sender ugyldige dager ser ellers ut som en app som synker fint.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAppConfig } from '$lib/server/app-registry';
import { findAppSensorId, getOrCreateAppSensorId } from '$lib/server/app-sensor';
import {
	isStale,
	normalizeTimelineDay,
	parseTimelineEnvelope,
	type NormalizedDay,
	type TimelineErrorCode
} from '$lib/domain/movement/timeline';
import {
	AKSER_APP_ID,
	deleteDay,
	deleteEverything,
	listKnownPlaceIds,
	readStoredGenerations,
	recordContact,
	replaceDay
} from '$lib/server/movement/akser-store';

type DayOutcome =
	| { date: string | null; status: 'stored'; stays: number; journeys: number }
	| { date: string | null; status: 'stale' }
	| { date: string | null; status: 'rejected'; error: TimelineErrorCode; message: string };

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Ugyldig JSON' }, { status: 400 });
	}

	const envelope = parseTimelineEnvelope(body);
	if (!envelope.ok) return json({ error: envelope.message }, { status: 400 });

	const app = getAppConfig(AKSER_APP_ID)!;
	const sensorId = await getOrCreateAppSensorId(userId, app);
	const knownPlaceIds = await listKnownPlaceIds(userId);

	const results: DayOutcome[] = [];
	const accepted: NormalizedDay[] = [];
	const seen = new Set<string>();
	for (const raw of envelope.days) {
		const normalized = normalizeTimelineDay(raw, knownPlaceIds);
		if (!normalized.ok) {
			results.push({
				date: normalized.date,
				status: 'rejected',
				error: normalized.code,
				message: normalized.message
			});
			continue;
		}
		if (seen.has(normalized.day.date)) {
			results.push({
				date: normalized.day.date,
				status: 'rejected',
				error: 'invalid_date',
				message: 'Samme dato forekommer to ganger i kallet'
			});
			continue;
		}
		seen.add(normalized.day.date);
		accepted.push(normalized.day);
		results.push({ date: normalized.day.date, status: 'stored', stays: 0, journeys: 0 });
	}

	const stored = await readStoredGenerations(
		userId,
		sensorId,
		accepted.map((day) => day.date)
	);
	for (const day of accepted) {
		const index = results.findIndex((r) => r.date === day.date && r.status === 'stored');
		if (isStale(stored.get(day.date), day.generatedAt)) {
			results[index] = { date: day.date, status: 'stale' };
			continue;
		}
		await replaceDay(userId, sensorId, day);
		results[index] = {
			date: day.date,
			status: 'stored',
			stays: day.stays.length,
			journeys: day.journeys.length
		};
	}

	const rejected = results.filter((r) => r.status === 'rejected');
	await recordContact(
		sensorId,
		rejected.length > 0
			? `${rejected.length} dag(er) avvist: ` +
					rejected.map((r) => `${r.date ?? '?'} ${'error' in r ? r.error : ''}`).join(', ')
			: null
	);

	console.log(
		`[akser] tidslinje user=${userId} lagret=${results.filter((r) => r.status === 'stored').length}` +
			` foreldet=${results.filter((r) => r.status === 'stale').length} avvist=${rejected.length}`
	);
	return json({ ok: true, results });
};

export const DELETE: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const app = getAppConfig(AKSER_APP_ID)!;
	const sensorId = await findAppSensorId(userId, app);

	if (url.searchParams.get('all') === 'true') {
		const deleted = await deleteEverything(userId, sensorId);
		console.log(`[akser] slettet alt user=${userId} hendelser=${deleted.events} steder=${deleted.places}`);
		return json({ ok: true, deleted });
	}

	const date = url.searchParams.get('date');
	if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		return json({ error: 'Oppgi ?date=YYYY-MM-DD eller ?all=true' }, { status: 400 });
	}
	const events = sensorId ? await deleteDay(userId, sensorId, date) : 0;
	return json({ ok: true, deleted: { events } });
};
