import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getWithingsSensor, getValidAccessToken } from '$lib/server/integrations/withings-sync';
import { fetchWithingsSleep } from '$lib/server/integrations/withings';
import { requireAdmin } from '$lib/server/admin-auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	await requireAdmin(locals.userId);
	const userId = locals.userId;

	// 1. Stored sleep events in DB
	const storedEvents = await db
		.select()
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'sleep')))
		.orderBy(desc(sensorEvents.timestamp))
		.limit(10);

	const dbSummary = storedEvents.map((e) => {
		const raw = e.data as unknown;
		/**
		 * Formen på `data`, ikke bare nøklene.
		 *
		 * `Object.keys()` ga `['0','1',…]` i prod, og det er tvetydig: både en array og
		 * en **streng** gir tallnøkler. Er raden dobbeltkodet JSON, er hvert felt
		 * utilgjengelig for alle lesere — `data.sleepDuration` er undefined uansett hvor
		 * riktig resten av koden er. Diagnosen må skille de tre.
		 */
		const shape = Array.isArray(raw)
			? 'array'
			: raw === null
				? 'null'
				: typeof raw === 'object'
					? 'object'
					: typeof raw;
		return {
			id: e.id,
			timestamp: e.timestamp,
			shape,
			hr_average: (raw as { hr_average?: unknown })?.hr_average ?? null,
			sleepDuration: (raw as { sleepDuration?: unknown })?.sleepDuration ?? null,
			hrv: (raw as { hrv?: unknown })?.hrv ?? null,
			dataKeys: shape === 'object' ? Object.keys(raw as object) : [],
			/** Første 300 tegn av rådataen, så formen kan ses med egne øyne. */
			rawPreview: JSON.stringify(raw)?.slice(0, 300) ?? null,
			metadataKeys: Object.keys((e.metadata as object) ?? {})
		};
	});

	const hrCount = dbSummary.filter((e) => e.hr_average !== null).length;

	const sensor = await getWithingsSensor(userId);
	if (!sensor) {
		return json({
			db: { totalEvents: storedEvents.length, eventsWithHr: hrCount, events: dbSummary },
			summary: { error: 'No Withings sensor found' },
			detail: { error: 'No Withings sensor found' }
		});
	}

	const accessToken = await getValidAccessToken(sensor);

	const startdateymd = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
	const enddateymd = new Date().toISOString().split('T')[0];

	/**
	 * 2. getsummary — med `data_fields` eksplisitt.
	 *
	 * Kallet ba historisk om ingenting, og fikk da Withings' standardsett. Det settet
	 * inneholder **ikke** hr_average/hr_min, så testen kunne ikke svare på om enheten
	 * leverer dem — den målte bare standardsettet. Vi ber om nøyaktig det samme settet
	 * synken ber om, slik at svaret her gjelder for synken.
	 */
	const summaryResponse = await fetchWithingsSleep(accessToken, {
		action: 'getsummary',
		startdateymd,
		enddateymd,
		data_fields: 'hr_average,hr_min,hr_max,total_sleep_time,sleep_score,rr_average'
	});
	const summarySeries: any[] = summaryResponse?.body?.series ?? [];
	const summaryData = summarySeries.slice(0, 7).map((s: any) => ({
		date: s.date,
		hr_average: s.data?.hr_average ?? null,
		hr_min: s.data?.hr_min ?? null,
		hr_max: s.data?.hr_max ?? null,
		rr_average: s.data?.rr_average ?? null,
		duration: s.data?.duration ?? null,
		dataKeys: Object.keys(s.data ?? {})
	}));

	// 3. get — granular data points (HR per minute, sleep stages, RR, snoring)
	//    Use the most recent night only to keep response size sane
	const enddate = Math.floor(Date.now() / 1000);
	const startdate = enddate - 14 * 24 * 60 * 60;
	const detailResponse = await fetchWithingsSleep(accessToken, {
		action: 'get',
		startdate,
		enddate,
		data_fields: 'hr,rr,snoring,sdnn_1'
	} as any);

	const detailSeries: any[] = detailResponse?.body?.series ?? [];

	// Group by night (date of startdate) and pick the most recent 3 nights
	const byNight = new Map<string, { segments: number; hrSamples: number; rrSamples: number; snoringSegments: number; sampleKeys: string[] }>();
	for (const seg of detailSeries) {
		const night = new Date(seg.startdate * 1000).toISOString().split('T')[0];
		const entry = byNight.get(night) ?? { segments: 0, hrSamples: 0, rrSamples: 0, snoringSegments: 0, sampleKeys: [] };
		entry.segments++;
		if (seg.hr != null) entry.hrSamples++;
		if (seg.rr != null) entry.rrSamples++;
		if (seg.snoring != null) entry.snoringSegments++;
		const keys = Object.keys(seg).filter((k) => !['startdate', 'enddate', 'state'].includes(k));
		for (const k of keys) {
			if (!entry.sampleKeys.includes(k)) entry.sampleKeys.push(k);
		}
		byNight.set(night, entry);
	}

	const detailNights = [...byNight.entries()]
		.sort(([a], [b]) => b.localeCompare(a))
		.slice(0, 3)
		.map(([date, stats]) => ({ date, ...stats }));

	// Also return a raw sample segment from the most recent night
	const latestNight = detailNights[0]?.date;
	const sampleSegments = latestNight
		? detailSeries
				.filter((s) => new Date(s.startdate * 1000).toISOString().split('T')[0] === latestNight)
				.slice(0, 5)
				.map((s) => ({
					startdate: new Date(s.startdate * 1000).toISOString(),
					state: s.state,
					hr: s.hr ?? null,
					rr: s.rr ?? null,
					snoring: s.snoring ?? null,
					allKeys: Object.keys(s)
				}))
		: [];

	return json({
		db: {
			totalEvents: storedEvents.length,
			eventsWithHr: hrCount,
			events: dbSummary
		},
		summary: {
			status: summaryResponse?.status,
			totalNights: summarySeries.length,
			nightsWithHr: summaryData.filter((s) => s.hr_average !== null).length,
			nights: summaryData
		},
		detail: {
			status: detailResponse?.status,
			error: detailResponse?.error ?? null,
			rawBodyKeys: detailResponse?.body ? Object.keys(detailResponse.body) : [],
			totalSegments: detailSeries.length,
			nights: detailNights,
			sampleSegments
		}
	});
};
