import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { canonicalWorkouts } from '$lib/db/schema';
import { getEffortBaseline } from '$lib/server/services/effort-service';
import { isBaselineComparable } from '$lib/domain/health/session-character';

/**
 * GET /api/helse/trening/sonebaseline?days=90&sport=running
 *
 * Hvilken baseline ble hver lagret sonefordeling regnet mot?
 *
 * ## Hvorfor endepunktet finnes
 *
 * 2. september 2026 viste sammensetningskortet «72 % hard» over nitti dager, for
 * en bruker hvis egne loggede økter lå på puls 120–136 med Z4 rundt 152. Tallet
 * var ikke troverdig, og terskelen i klassifisereren var den åpenbare mistenkte.
 *
 * Men `hrZoneDistribution` er LAGRET per økt, med `basis`, `restHr` og `maxHr`
 * innbakt — regnet på analysetidspunktet. Rader fra før sonemodellen ble ryddet
 * kan være bøttet av helt andre bånd, og da klassifiserer vi historikk mot en
 * makspuls som ikke er brukerens.
 *
 * Å justere terskelen mot et slikt tall er å kalibrere mot støy. Dette
 * endepunktet svarer på hvilken av de to feilene det er, før noen rører en
 * konstant.
 *
 * Rent lesende. `POST /api/sensors/workouts/reanalyze` er handlingen.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const days = Math.min(3660, Math.max(1, Number(url.searchParams.get('days') ?? 90)));
	const sportFamily = url.searchParams.get('sport') ?? 'running';
	const since = new Date(Date.now() - days * 86_400_000);

	const [baselineRaw, rows] = await Promise.all([
		getEffortBaseline(userId).catch(() => null),
		db
			.select({
				startTime: canonicalWorkouts.startTime,
				analyticsComputedAt: canonicalWorkouts.analyticsComputedAt,
				hrZoneDistribution: canonicalWorkouts.hrZoneDistribution
			})
			.from(canonicalWorkouts)
			.where(
				and(
					eq(canonicalWorkouts.userId, userId),
					eq(canonicalWorkouts.sportFamily, sportFamily),
					gte(canonicalWorkouts.startTime, since),
					isNotNull(canonicalWorkouts.distanceMeters)
				)
			)
	]);

	const current = baselineRaw
		? { basis: 'hrr', restHr: baselineRaw.restHr, maxHr: baselineRaw.maxHr }
		: null;

	/** Grupperer på den EKSAKTE baselinen, så spredningen er synlig i ett blikk. */
	const groups = new Map<
		string,
		{ basis: string; restHr: number; maxHr: number; sessions: number; comparable: boolean; oldest: string; newest: string }
	>();
	let withoutZones = 0;

	for (const row of rows) {
		const dist = row.hrZoneDistribution;
		if (!dist) {
			withoutZones += 1;
			continue;
		}
		const stored = { basis: dist.basis, restHr: dist.restHr, maxHr: dist.maxHr };
		const key = `${stored.basis}:${stored.restHr}:${stored.maxHr}`;
		const day = row.startTime.toISOString().slice(0, 10);
		const existing = groups.get(key);
		if (existing) {
			existing.sessions += 1;
			if (day < existing.oldest) existing.oldest = day;
			if (day > existing.newest) existing.newest = day;
		} else {
			groups.set(key, {
				...stored,
				sessions: 1,
				comparable: isBaselineComparable(stored, current),
				oldest: day,
				newest: day
			});
		}
	}

	const baselines = [...groups.values()].sort((a, b) => b.sessions - a.sessions);
	const comparable = baselines.filter((g) => g.comparable).reduce((n, g) => n + g.sessions, 0);
	const stale = baselines.filter((g) => !g.comparable).reduce((n, g) => n + g.sessions, 0);

	return json({
		days,
		sportFamily,
		current,
		sessions: rows.length,
		withoutZones,
		comparable,
		stale,
		/**
		 * Hvor mange ULIKE baseliner historikken er regnet mot. Er dette 1 og
		 * `stale` er 0, er sammensetningen til å stole på og terskelen er den
		 * neste mistenkte. Er det flere, skal ingen konstant røres før en
		 * reanalyse har kjørt.
		 */
		distinctBaselines: baselines.length,
		baselines,
		action:
			stale > 0
				? 'POST /api/sensors/workouts/reanalyze — historikken må regnes om før sammensetningen kan leses'
				: null
	});
};
