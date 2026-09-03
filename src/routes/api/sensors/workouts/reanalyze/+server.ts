import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { canonicalWorkouts, sensorEvents } from '$lib/db/schema';
import { and, count, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { analyzeWorkout, type TrackPoint } from '$lib/server/workouts/workout-analytics';
import { getEffortBaseline } from '$lib/server/services/effort-service';

/**
 * POST /api/sensors/workouts/reanalyze
 *
 * Idempotent backfill av workout-analytics for brukerens løpeøkter.
 *
 * ## Tre utvalg, og standarden fyller ikke et NYTT felt
 *
 * - Standard: rader uten `analyticsComputedAt`. Det var nok så lenge analytics
 *   var alt-eller-ingenting.
 * - `?missing=intensitySplit`: rader der NETTOPP det feltet er null. Uten dette
 *   utvalget kan et felt lagt til i ettertid ikke fylles — historikken har
 *   `analyticsComputedAt` satt fra den gangen feltet ikke fantes, så standarden
 *   ser den som ferdig. Feilen er stum: jobben svarer «analyzed: 0» og ser
 *   fullført ut.
 * - `?force=true`: alt, uansett. Sisteutvei.
 *
 * ## Vinduet er en MARKØR, ikke et sidetall
 *
 * `?limit` (default 40) og `?before=<ISO>` pagineres synkende på `startTime`.
 * Markøren finnes fordi en teller ikke kan termineres: en økt uten trackPoints
 * får aldri feltet, så «kjør til ingen mangler» ville løpt i evig løkke over de
 * samme radene. Svarets `nextBefore` er null når batchen var mindre enn limit,
 * altså når vi er gjennom.
 *
 * Grensa finnes uansett fordi trackPoints er tunge: ett kall over ni år med
 * løping ville lastet hvert spor i minnet samtidig.
 */

/** Felt som kan etterfylles for seg. Nye felt hører HER, ikke i en query-string. */
const MISSING_FIELDS = {
	intensitySplit: canonicalWorkouts.intensitySplit,
	hrZoneDistribution: canonicalWorkouts.hrZoneDistribution,
	bestEfforts: canonicalWorkouts.bestEfforts
} as const;

type MissingField = keyof typeof MISSING_FIELDS;

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;

export const POST: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const force = url.searchParams.get('force') === 'true';
	const dryRun = url.searchParams.get('dryRun') === 'true';
	const missingParam = url.searchParams.get('missing');
	const beforeParam = url.searchParams.get('before');

	if (missingParam && !(missingParam in MISSING_FIELDS)) {
		// 400 framfor en stille full reanalyse: en skrivefeil i feltnavnet ville
		// ellers kjørt et helt annet — og mye tyngre — utvalg enn det man ba om.
		return json(
			{
				error: `Ukjent felt «${missingParam}». Gyldige: ${Object.keys(MISSING_FIELDS).join(', ')}`
			},
			{ status: 400 }
		);
	}
	const missing = (missingParam ?? null) as MissingField | null;

	const limitRaw = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
	const limit = Number.isFinite(limitRaw)
		? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitRaw)))
		: DEFAULT_LIMIT;

	let before: Date | null = null;
	if (beforeParam) {
		const parsed = new Date(beforeParam);
		if (Number.isNaN(parsed.getTime())) {
			return json({ error: `Ugyldig «before»: ${beforeParam}` }, { status: 400 });
		}
		before = parsed;
	}

	/** Utvalget, delt mellom tellingen og kandidatspørringen. */
	const selection = and(
		eq(canonicalWorkouts.userId, userId),
		eq(canonicalWorkouts.sportFamily, 'running'),
		missing ? isNull(MISSING_FIELDS[missing]) : undefined,
		!missing && !force ? isNull(canonicalWorkouts.analyticsComputedAt) : undefined
	);

	// Hvor mange som mangler i det hele tatt — uavhengig av markøren, så tallet
	// betyr det samme gjennom hele gjennomkjøringen.
	const [{ total }] = await db
		.select({ total: count() })
		.from(canonicalWorkouts)
		.where(selection);

	if (dryRun) {
		return json({
			ok: true,
			dryRun: true,
			outstanding: total,
			limit,
			filled: 0,
			analyzedWithoutField: 0,
			analyzed: 0,
			skipped: 0
		});
	}

	const candidates = await db
		.select({
			id: canonicalWorkouts.id,
			startTime: canonicalWorkouts.startTime,
			evidence: canonicalWorkouts.evidence
		})
		.from(canonicalWorkouts)
		.where(before ? and(selection, lt(canonicalWorkouts.startTime, before)) : selection)
		.orderBy(desc(canonicalWorkouts.startTime))
		.limit(limit);

	// Markøren settes av batchens ELDSTE rad, og bare når batchen var full: en
	// kortere batch betyr at det ikke finnes flere bak den.
	const nextBefore =
		candidates.length === limit
			? (candidates[candidates.length - 1]?.startTime?.toISOString() ?? null)
			: null;

	if (candidates.length === 0) {
		return json({
			ok: true,
			filled: 0,
			analyzedWithoutField: 0,
			analyzed: 0,
			skipped: 0,
			candidates: 0,
			outstanding: total,
			nextBefore: null,
			message: 'Ingen kandidater'
		});
	}

	const baseline = await getEffortBaseline(userId);
	const eventIdToCanonical = new Map<string, string>();
	const eventIds = new Set<string>();
	for (const c of candidates) {
		const ev = (c.evidence ?? []) as Array<{ eventId?: string }>;
		for (const e of ev) {
			if (e.eventId) {
				eventIds.add(e.eventId);
				if (!eventIdToCanonical.has(e.eventId)) eventIdToCanonical.set(e.eventId, c.id);
			}
		}
	}

	if (eventIds.size === 0) {
		return json({
			ok: true,
			filled: 0,
			analyzedWithoutField: 0,
			analyzed: 0,
			skipped: candidates.length,
			candidates: candidates.length,
			outstanding: total,
			nextBefore,
			message: 'Ingen evidence-events'
		});
	}

	const rows = await db
		.select({
			id: sensorEvents.id,
			trackPoints: sql<TrackPoint[] | null>`${sensorEvents.data}->'trackPoints'`
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				sql`${sensorEvents.id} IN (${sql.join(
					[...eventIds].map((id) => sql`${id}`),
					sql`, `
				)})`
			)
		);

	// Aggreger beste analytics per canonical-workout (best score wins)
	const bestPerCanonical = new Map<string, ReturnType<typeof analyzeWorkout>>();
	const scoreOf = (a: ReturnType<typeof analyzeWorkout>) =>
		(a.bestEfforts ? Object.keys(a.bestEfforts).length : 0) +
		(a.gapSecPerKm != null ? 1 : 0) +
		(a.hrZoneDistribution ? 1 : 0) +
		(a.intensitySplit ? 1 : 0);

	for (const row of rows) {
		const pts = Array.isArray(row.trackPoints) ? row.trackPoints : null;
		if (!pts || pts.length < 2) continue;
		const canonicalId = eventIdToCanonical.get(row.id);
		if (!canonicalId) continue;
		const a = analyzeWorkout(pts, { restHr: baseline.restHr, maxHr: baseline.maxHr });
		if (scoreOf(a) === 0) continue;
		const existing = bestPerCanonical.get(canonicalId);
		if (!existing || scoreOf(a) > scoreOf(existing)) {
			bestPerCanonical.set(canonicalId, a);
		}
	}

	// TRE utfall, ikke to. En skriving er ikke et treff: en økt med spor men uten
	// brukbar pulskurve får `bestEfforts` og GAP, mens det feltet du BA om blir
	// stående null. Telles den som «analysert», summerer ikke tallene — 63
	// analysert + 484 uten data mot 495 gjenstående, målt 3. september 2026, og
	// de elleve i differansen var nettopp dette utfallet.
	let filled = 0;
	let analyzedWithoutField = 0;
	let skipped = 0;
	const now = new Date();
	for (const c of candidates) {
		const a = bestPerCanonical.get(c.id);
		if (!a) {
			// Ingen trackPoints i det hele tatt (eller ingen evidence som svarte).
			skipped += 1;
			continue;
		}
		await db
			.update(canonicalWorkouts)
			.set({
				bestEfforts: a.bestEfforts ?? null,
				gapSecPerKm: a.gapSecPerKm != null ? String(a.gapSecPerKm) : null,
				hrZoneDistribution: a.hrZoneDistribution ?? null,
				intensitySplit: a.intensitySplit ?? null,
				analyticsComputedAt: now,
				updatedAt: now
			})
			.where(eq(canonicalWorkouts.id, c.id));
		// Fikk raden feltet som ble etterspurt? Uten `missing` er spørsmålet
		// «ble noe skrevet», og da er hver skriving et treff.
		if (!missing || a[missing] != null) filled += 1;
		else analyzedWithoutField += 1;
	}

	return json({
		ok: true,
		filled,
		analyzedWithoutField,
		skipped,
		// Skrivinger totalt. Beholdt fordi den svarer på «rørte jobben noe», men
		// `filled` er tallet en flate skal vise.
		analyzed: filled + analyzedWithoutField,
		candidates: candidates.length,
		outstanding: total,
		nextBefore,
		baseline: {
			restHr: baseline.restHr,
			maxHr: baseline.maxHr,
			maxHrSource: baseline.maxHrSource ?? null
		}
	});
};
