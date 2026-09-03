/**
 * Laster de to lagene bak «hvilke perioder er pulsdata til å stole på».
 *
 * Reglene bor rent i `$lib/domain/health/hr-trust-periods.ts`; her er bare
 * datainnhentingen — og valgene som gjør lag 2 billig nok å kjøre fra en
 * telefon.
 */

import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { canonicalWorkouts, sensorEvents } from '$lib/db/schema';
import { getEffortBaseline } from '$lib/server/services/effort-service';
import { diagnoseHrSeries } from '$lib/domain/health/hr-artefacts';
import {
	buildHrTrustPeriods,
	describeHrTrust,
	type HrTrustCurveSample,
	type HrTrustPeriod
} from '$lib/domain/health/hr-trust-periods';
import { osloDayKey } from '$lib/domain/oslo-time';

/**
 * Hvor mange kurver som hentes per periode i lag 2.
 *
 * Fem er valgt fordi sporene er tunge — det var grunnen til markøren i
 * reanalyse-jobben — og fordi utvalget skal AVSLØRE et ødelagt belte, ikke måle
 * en andel. To fastlåste kurver i samme år avgjør spørsmålet; en sjette kurve
 * legger ikke til noe.
 */
export const CURVE_SAMPLE_PER_PERIOD = 5;

/**
 * Tak på ANTALL ØKTER lag 2 henter spor for, uansett hvor mange perioder.
 *
 * Fem per periode ganger ni år er 45 økter, og hver økt kan ha spor fra tre
 * kilder — altså opptil ~135 trackPoints-arrayer i ÉN spørring, hver på opptil
 * 2000 punkter. Førti er tallet reanalyse-jobben er målt trygg på, og det er
 * grunnen til at det er valgt her også.
 *
 * Utvalget tynnes JEVNT over lista når taket treffer, ikke ved å kappe halen:
 * en kapping ville tatt de siste periodene helt bort, og «hvilke år» er
 * nettopp spørsmålet.
 */
export const MAX_CURVE_SAMPLE_TOTAL = 40;

/** Under dette antallet punkter er en kurve ikke verdt å hente. */
const MIN_TRACK_POINTS = 10;

export interface HrTrustReport {
	baseline: { restHr: number; maxHr: number; maxHrSource: string | null };
	periods: HrTrustPeriod[];
	text: string[];
	curveSample: {
		perPeriod: number;
		/** Taket på antall økter, uansett antall perioder. */
		maxTotal: number;
		requested: number;
		loaded: number;
	};
}

export async function loadHrTrustReport(
	userId: string,
	options: { sportFamily?: string; sampleCurves?: boolean } = {}
): Promise<HrTrustReport> {
	const sportFamily = options.sportFamily ?? 'running';

	const [baseline, rows] = await Promise.all([
		getEffortBaseline(userId),
		// Hele historikken, uten datogrense: spørsmålet ER «hvilke år». Bare
		// skalarene hentes, så ni år koster én lett spørring.
		db
			.select({
				id: canonicalWorkouts.id,
				startTime: canonicalWorkouts.startTime,
				avgHr: canonicalWorkouts.avgHeartRate,
				maxHr: canonicalWorkouts.maxHeartRate,
				evidence: canonicalWorkouts.evidence
			})
			.from(canonicalWorkouts)
			.where(
				and(
					eq(canonicalWorkouts.userId, userId),
					eq(canonicalWorkouts.sportFamily, sportFamily),
					isNotNull(canonicalWorkouts.startTime)
				)
			)
			.orderBy(asc(canonicalWorkouts.startTime))
	]);

	const sessions = rows.map((row) => ({
		startTime: row.startTime,
		avgHr: row.avgHr === null ? null : Number(row.avgHr),
		maxHr: row.maxHr === null ? null : Number(row.maxHr)
	}));

	let curves: HrTrustCurveSample[] = [];
	let requested = 0;
	if (options.sampleCurves) {
		const picked = thinToCap(pickCurveSample(rows), MAX_CURVE_SAMPLE_TOTAL);
		requested = picked.length;
		curves = await diagnoseSampledCurves(userId, picked);
	}

	const periods = buildHrTrustPeriods(
		sessions,
		{ restHr: baseline.restHr, maxHr: baseline.maxHr },
		curves
	);

	return {
		baseline: {
			restHr: baseline.restHr,
			maxHr: baseline.maxHr,
			maxHrSource: baseline.maxHrSource ?? null
		},
		periods,
		text: describeHrTrust(periods),
		curveSample: {
			perPeriod: CURVE_SAMPLE_PER_PERIOD,
			maxTotal: MAX_CURVE_SAMPLE_TOTAL,
			requested,
			loaded: curves.length
		}
	};
}

interface CandidateRow {
	id: string;
	startTime: Date;
	evidence: Array<{ eventId?: string }> | null;
}

interface PickedCurve {
	period: string;
	eventIds: string[];
}

/**
 * Velger kurvene lag 2 skal hente: opptil `CURVE_SAMPLE_PER_PERIOD` per periode,
 * **spredt utover** perioden.
 *
 * Spredningen er ikke pynt. «De fem første» er alle i januar, og et belte som
 * ble ødelagt i mai ville da sett friskt ut hele året. Indeksene plukkes derfor
 * jevnt gjennom periodens økter.
 */
function pickCurveSample(rows: CandidateRow[]): PickedCurve[] {
	const byPeriod = new Map<string, CandidateRow[]>();
	for (const row of rows) {
		const withEvidence = (row.evidence ?? []).some((e) => e?.eventId);
		if (!withEvidence) continue;
		const period = osloDayKey(row.startTime).slice(0, 4);
		const list = byPeriod.get(period);
		if (list) list.push(row);
		else byPeriod.set(period, [row]);
	}

	const picked: PickedCurve[] = [];
	for (const [period, list] of byPeriod) {
		const take = Math.min(CURVE_SAMPLE_PER_PERIOD, list.length);
		for (let i = 0; i < take; i += 1) {
			// Jevnt fordelte indekser: (i + 0,5) / take treffer midten av hver bolk,
			// så første og siste økt i perioden ikke systematisk velges bort.
			const index = Math.min(list.length - 1, Math.floor(((i + 0.5) * list.length) / take));
			const row = list[index];
			const eventIds = (row.evidence ?? [])
				.map((e) => e?.eventId)
				.filter((id): id is string => typeof id === 'string');
			if (eventIds.length > 0) picked.push({ period, eventIds });
		}
	}
	return picked;
}

/**
 * Tynner utvalget jevnt ned til taket.
 *
 * Lista er gruppert per periode, så en jevn sil beholder omtrent samme andel
 * fra hvert år — i motsetning til en `slice`, som ville tatt de siste årene
 * helt bort.
 */
function thinToCap<T>(items: T[], cap: number): T[] {
	if (items.length <= cap) return items;
	const kept: T[] = [];
	for (let i = 0; i < cap; i += 1) {
		kept.push(items[Math.floor((i * items.length) / cap)]);
	}
	return kept;
}

/**
 * Henter sporene for utvalget og dømmer hver kurve.
 *
 * Radene slås opp på **id fra canonical evidence**, aldri med et filter på
 * `data_type`: canonical er alt det dedupliserte laget, og et rått typefilter
 * her ville både gitt tre rader for samme tur og trippet vakten i
 * `sensor-event-access.ts`.
 *
 * En økt kan ha flere kilder som beskriver den. Vi dømmer den BESTE kurven:
 * spørsmålet er om det finnes brukbar puls for økta, og en tom GPX fra Dropbox
 * ved siden av en god Ekko-opplasting skal ikke gjøre året mistenkelig.
 */
async function diagnoseSampledCurves(
	userId: string,
	picked: PickedCurve[]
): Promise<HrTrustCurveSample[]> {
	if (picked.length === 0) return [];

	const allIds = [...new Set(picked.flatMap((p) => p.eventIds))];
	const rows = await db
		.select({
			id: sensorEvents.id,
			trackPoints: sql<
				Array<{ hr?: number; time?: string }> | null
			>`${sensorEvents.data}->'trackPoints'`
		})
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), inArray(sensorEvents.id, allIds)));

	const byId = new Map(rows.map((row) => [row.id, row.trackPoints]));
	const samples: HrTrustCurveSample[] = [];

	for (const item of picked) {
		let best: ReturnType<typeof diagnoseHrSeries> | null = null;
		for (const eventId of item.eventIds) {
			const points = byId.get(eventId);
			if (!Array.isArray(points) || points.length < MIN_TRACK_POINTS) continue;
			const diagnosis = diagnoseHrSeries(toHrSamples(points));
			if (diagnosis.samples === 0) continue;
			// Brukbar slår ubrukelig; ellers vinner den med flest punkter.
			if (
				!best ||
				(diagnosis.usable && !best.usable) ||
				(diagnosis.usable === best.usable && diagnosis.samples > best.samples)
			) {
				best = diagnosis;
			}
		}
		if (best) samples.push({ period: item.period, usable: best.usable, reasons: best.reasons });
	}
	return samples;
}

/**
 * Punktene om til pulsserien vakta tar.
 *
 * Sekundene regnes fra det FØRSTE gyldige tidsstempelet, ikke fra sporets
 * første punkt: et punkt uten tid faller ut, og et nullpunkt fra en rad som ble
 * kastet ville forskjøvet hele serien.
 */
function toHrSamples(points: Array<{ hr?: number; time?: string }>): Array<{ tSec: number; hr: number }> {
	const samples: Array<{ tSec: number; hr: number }> = [];
	let t0: number | null = null;
	for (const point of points) {
		if (typeof point.hr !== 'number' || !(point.hr > 0)) continue;
		if (!point.time) continue;
		const tMs = Date.parse(point.time);
		if (!Number.isFinite(tMs)) continue;
		if (t0 === null) t0 = tMs;
		samples.push({ tSec: (tMs - t0) / 1000, hr: point.hr });
	}
	return samples;
}
