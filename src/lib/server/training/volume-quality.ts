/**
 * Slepende volum og sonesammensetning — én laster for flate, widget og chat.
 *
 * Bygger på `canonical_workouts`, som er den lagrede dedupliserte utgaven: samme
 * tur skrevet av klokka, Dropbox og Ekko teller én gang. Se
 * `running-history.ts` for hvorfor det er den riktige tabellen.
 *
 * **Alle tre flatene leser denne.** Widgetdetaljen, trenings-dashboardet og
 * `query_training` skal ikke kunne svare ulikt på «hvor mye har jeg løpt siste
 * tretti dager» — det er den feilen dette repoet har betalt for flest ganger.
 */

import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { canonicalWorkouts } from '$lib/db/schema';
import { canonicalDistanceMeters } from '$lib/server/activity-layer';
import { osloDayKey } from '$lib/domain/oslo-time';
import {
	buildTrailingSeries,
	describeTrailingVolume,
	levelAgainstReference,
	trailingBandForDate,
	trailingRamp,
	type TrailingBand,
	type TrailingLevel,
	type TrailingRamp,
	type TrailingSeries
} from '$lib/domain/health/trailing-volume';
import {
	composeCharacters,
	describeComposition,
	isBaselineComparable,
	type CharacterComposition,
	type SessionInput,
	type SessionZoneBaseline
} from '$lib/domain/health/session-character';
import {
	buildWeeklyIntensity,
	describeWeeklyIntensity,
	totalsFor,
	type IntensityTotals,
	type SessionIntensity,
	type WeekIntensity
} from '$lib/domain/health/weekly-intensity';
import { getEffortBaseline } from '$lib/server/services/effort-service';
import type { DayValue } from '$lib/domain/health/cycle-series';

/**
 * Hvor langt tilbake kurven tegnes.
 *
 * To år framfor ti: kurven leses av, i motsetning til sesongkurvenes bakgrunn, og
 * to år er nok til at båndet får to tidligere observasjoner per dato. Taket er
 * på RADER, som er det som koster bytes — samme lærdom som `MAX_CHART_POINTS` i
 * vektgrafen, der et anslag av datavolum kappet bort halve historikken.
 */
export const TRAILING_CHART_DAYS = 730;

/** Vinduene flaten tilbyr. 30 er default fordi det er widgetens vindu. */
export const TRAILING_WINDOWS = [7, 30, 90] as const;
export type TrailingWindow = (typeof TRAILING_WINDOWS)[number];

/** Vinduene sonesammensetningen regnes for. */
export const COMPOSITION_WINDOWS = [7, 30, 90] as const;

/**
 * Hvor mange uker intensitetsbjelken dekker.
 *
 * Tolv uker er et kvartal: nok til at en oppbyggingsperiode er synlig, og få nok
 * til at hver bjelke er bred nok å trykke på på en telefon. Vinduet er i UKER og
 * ikke i dager fordi bjelken er per uke — en dagsakse ville sagt noe annet enn
 * den viser.
 */
export const INTENSITY_WEEKS = 12;

export interface TrailingVolumeView {
	windowDays: number;
	series: TrailingSeries;
	band: TrailingBand | null;
	ramp: TrailingRamp | null;
	level: TrailingLevel | null;
	/** Setningen flaten og chatten deler. Se `describeTrailingVolume`. */
	text: string;
}

export interface QualityView {
	composition: CharacterComposition;
	text: string;
}

export interface IntensityView {
	/** Én bjelke per uke, eldste først. Uker uten trening er nuller, ikke hull. */
	weeks: WeekIntensity[];
	totals: IntensityTotals;
	/** Setningen flaten og chatten deler. Se `describeWeeklyIntensity`. */
	text: string;
	/**
	 * Hvor mange av øktene i vinduet som har tidsdelingen i det hele tatt.
	 *
	 * Feltet er nytt (september 2026) og fylles bare av en analyse, så
	 * historikken er tom til `POST /api/sensors/workouts/reanalyze` har kjørt.
	 * Uten dette tallet ser en tom bjelke ut som en uke uten trening.
	 */
	coverage: {
		sessions: number;
		withSplit: number;
		share: number;
		/**
		 * Økter der tidsdelingen ble regnet mot en annen baseline enn dagens.
		 *
		 * De TELLES MED likevel, i motsetning til i sonesammensetningen: å droppe
		 * dem ville laget hull i bjelkene, og et hull leses som en hvileuke — en
		 * verre feil enn minutter som er bøttet mot bånd et par slag unna. Tallet
		 * rapporteres så flaten kan si det, og handlingen er en reanalyse.
		 */
		staleBaseline: number;
	};
}

export interface VolumeQualityResult {
	today: string;
	sportFamily: string;
	/** Slepende volum per vindu, nøklet på antall dager. */
	volume: Record<number, TrailingVolumeView>;
	/** Sonesammensetning per vindu. */
	quality: Record<number, QualityView>;
	/**
	 * Rolige minutter, kvalitetsminutter og grått per uke.
	 *
	 * Står ved siden av `quality` og ikke i stedet for den mens dekningen bygges
	 * opp: sonefordelingen finnes på historikken, tidsdelingen gjør det ikke før
	 * en reanalyse har kjørt.
	 */
	intensity: IntensityView;
	/**
	 * Hvor stor andel av øktene siste 90 dager som har sonefordeling.
	 *
	 * Ligger på toppnivå fordi det er svaret på «kan vi i det hele tatt si noe om
	 * sammensetning» — og fordi det er tallet som avgjør om dekningen må fikses
	 * (`POST /api/sensors/workouts/reanalyze`) framfor å bygge mer flate.
	 */
	zoneCoverage: {
		sessions: number;
		withZones: number;
		share: number;
		/**
		 * Økter som HAR pulskurve, men er analysert mot en annen baseline enn
		 * dagens — og derfor ikke kan klassifiseres.
		 *
		 * Eget tall fordi handlingen er en annen: dette rettes av en reanalyse
		 * (`POST /api/sensors/workouts/reanalyze`), ikke av å bruke pulsbelte. Uten
		 * skillet ser «lav dekning» ut som et sensorproblem når det er et
		 * beregningsproblem.
		 */
		staleBaseline: number;
		/** Dagens baseline, så flaten kan si hva den sammenlignet mot. */
		baseline: SessionZoneBaseline | null;
	};
}


/**
 * Leser løpeøkter og bygger begge svarene.
 *
 * `goalKm` er widgetens målverdi når den finnes. Den er en **inngang**, ikke noe
 * lasteren finner selv: målet bor på widgeten brukeren trykket på, og en laster
 * som gjettet et mål ville gitt to ulike «i rute» på to flater.
 */
export async function loadVolumeAndQuality(
	userId: string,
	options: { sportFamily?: string; goalKm?: number | null; now?: Date } = {}
): Promise<VolumeQualityResult> {
	const sportFamily = options.sportFamily ?? 'running';
	const now = options.now ?? new Date();
	const today = osloDayKey(now);

	// Vinduet må dekke kurven PLUSS det lengste slepet, ellers er de første
	// punktene ufullstendige uten grunn.
	const lookbackDays = TRAILING_CHART_DAYS + Math.max(...TRAILING_WINDOWS);
	const since = new Date(now.getTime() - lookbackDays * 86_400_000);

	const baselineRaw = await getEffortBaseline(userId).catch(() => null);
	// Dagens bånd. Lagrede sonefordelinger som ble regnet mot noe annet kan ikke
	// klassifiseres — se `isBaselineComparable`.
	const currentBaseline: SessionZoneBaseline | null = baselineRaw
		? { basis: 'hrr', restHr: baselineRaw.restHr, maxHr: baselineRaw.maxHr }
		: null;

	const rows = await db
		.select({
			startTime: canonicalWorkouts.startTime,
			distanceMeters: canonicalWorkouts.distanceMeters,
			durationSeconds: canonicalWorkouts.durationSeconds,
			hrZoneDistribution: canonicalWorkouts.hrZoneDistribution,
			intensitySplit: canonicalWorkouts.intensitySplit
		})
		.from(canonicalWorkouts)
		.where(
			and(
				eq(canonicalWorkouts.userId, userId),
				eq(canonicalWorkouts.sportFamily, sportFamily),
				gte(canonicalWorkouts.startTime, since),
				isNotNull(canonicalWorkouts.distanceMeters)
			)
		);

	const days: DayValue[] = [];
	const sessions: SessionInput[] = [];
	const intensities: SessionIntensity[] = [];
	/** Økter med tidsdeling regnet mot noe annet enn dagens bånd. */
	let staleSplits = 0;
	for (const row of rows) {
		// Oslo-dagen, ikke UTC-datoen: en kveldsøkt kl. 23 hører til den dagen den
		// føltes som. Samme regel som `running-history.ts`.
		const date = osloDayKey(row.startTime);
		// NB: `canonicalDistanceMeters`, ALDRI `normalizeDistanceMeters` — kolonnen
		// er alt normalisert, og en ny runde med km-heuristikken gjør en søppelrad
		// på 53 meter til 53 kilometer.
		const meters = canonicalDistanceMeters(row.distanceMeters);
		const km = meters != null ? meters / 1000 : null;
		if (km != null && km > 0) days.push({ date, value: km });
		const dist = row.hrZoneDistribution as
			| (NonNullable<SessionInput['zones']> & SessionZoneBaseline)
			| null;
		const split = row.intensitySplit;
		if (split) {
			intensities.push({
				date,
				easySeconds: split.easySeconds,
				greySeconds: split.greySeconds,
				qualitySeconds: split.qualitySeconds,
				measuredSeconds: split.measuredSeconds
			});
			if (
				!isBaselineComparable(
					{ basis: split.basis, restHr: split.restHr, maxHr: split.maxHr },
					currentBaseline
				)
			) {
				staleSplits += 1;
			}
		}
		sessions.push({
			date,
			distanceKm: km,
			durationSeconds: row.durationSeconds != null ? Number(row.durationSeconds) : null,
			zones: dist ?? null,
			zoneBaseline: dist
				? { basis: dist.basis, restHr: dist.restHr, maxHr: dist.maxHr }
				: null
		});
	}

	const volume: Record<number, TrailingVolumeView> = {};
	for (const windowDays of TRAILING_WINDOWS) {
		const series = buildTrailingSeries(days, {
			windowDays,
			today,
			historyDays: TRAILING_CHART_DAYS
		});
		const band = trailingBandForDate(series, today);
		const ramp = trailingRamp(series, today);
		// Målet gjelder BARE vinduet det ble satt for. Et mål på «120 km per 30
		// dager» sier ingenting om syv dager, og å skalere det ned til 28 km ville
		// vært en påstand brukeren ikke har gjort.
		const goalKm = windowDays === 30 ? (options.goalKm ?? null) : null;
		const level = levelAgainstReference(series.current, { goalKm, band });
		volume[windowDays] = {
			windowDays,
			series,
			band,
			ramp,
			level,
			text: describeTrailingVolume({ current: series.current, windowDays, level, ramp, band })
		};
	}

	const quality: Record<number, QualityView> = {};
	for (const windowDays of COMPOSITION_WINDOWS) {
		const from = dayKeyDaysAgo(today, windowDays - 1);
		const inWindow = sessions.filter((s) => s.date >= from && s.date <= today);
		const composition = composeCharacters(inWindow, windowDays, currentBaseline);
		quality[windowDays] = { composition, text: describeComposition(composition) };
	}

	const intensityWeeks = buildWeeklyIntensity(intensities, {
		today,
		weeks: INTENSITY_WEEKS
	});
	const intensityTotals = totalsFor(intensityWeeks);
	// Dekningen måles over de samme ukene bjelken tegner, ikke over 90 dager:
	// spørsmålet er om GRAFEN er til å lese, og den dekker tolv uker.
	const intensityFrom = intensityWeeks[0]?.weekStart ?? today;
	const intensitySessions = sessions.filter((s) => s.date >= intensityFrom && s.date <= today);
	const withSplit = intensities.filter((s) => s.date >= intensityFrom && s.date <= today).length;

	const coverageFrom = dayKeyDaysAgo(today, 89);
	const coverageSessions = sessions.filter((s) => s.date >= coverageFrom && s.date <= today);
	const withZones = coverageSessions.filter((s) => s.zones !== null).length;
	const staleBaseline = coverageSessions.filter(
		(s) => s.zones !== null && !isBaselineComparable(s.zoneBaseline, currentBaseline)
	).length;

	return {
		today,
		sportFamily,
		volume,
		quality,
		intensity: {
			weeks: intensityWeeks,
			totals: intensityTotals,
			text: describeWeeklyIntensity(intensityTotals),
			coverage: {
				sessions: intensitySessions.length,
				withSplit,
				share: intensitySessions.length > 0 ? withSplit / intensitySessions.length : 0,
				staleBaseline: staleSplits
			}
		},
		zoneCoverage: {
			sessions: coverageSessions.length,
			withZones,
			share: coverageSessions.length > 0 ? withZones / coverageSessions.length : 0,
			staleBaseline,
			baseline: currentBaseline
		}
	};
}

function dayKeyDaysAgo(today: string, days: number): string {
	const [y, m, d] = today.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}
