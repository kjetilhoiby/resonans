/**
 * Vekt-dashboardet oversatt til noe en modell kan svare ut fra.
 *
 * Samme hull som trening hadde: `loadWeightDashboardData` hadde én kaller — sitt
 * eget dashboard-endepunkt — så trend, milepæler og kroppssammensetning var
 * usynlige for chatten. `query_sensor_data` med `metric='weight'` gir siste
 * måling og ingenting mer, og siste måling er nettopp tallet som lyver: en
 * dehydrert morgen er ikke en utvikling.
 *
 * ## Trenden, ikke målingen
 *
 * Alle endringstall her regnes på **trenden** (etterslepende 7-dagerssnitt), av
 * samme grunn som `weight-milestones` gjør det. Rå målinger spriker et kilo på
 * væske, og en modell som sammenligner to enkeltmålinger vil rapportere støy som
 * framgang — i tilfeldig retning.
 */

import {
	buildMetricSeries,
	dayNumber,
	type MetricPoint,
	type WeightDay
} from '$lib/domain/health/weight-series';
import {
	summarizeMonthlyWeights,
	type MonthlyWeight
} from '$lib/domain/health/weight-monthly';
import { summarizeDeclines, type WeightDecline } from '$lib/domain/health/weight-declines';

export interface WeightSummaryInput {
	/** Stigende, fra `dailyWeights`. */
	days: WeightDay[];
	milestones: Array<{
		kind: string;
		sentence: string;
		tone: string;
		basis: string;
		sinceDate?: string;
		longestGapDays?: number;
	}>;
	historyDays: number;
	weighIns: number;
	enoughHistory: boolean;
	/**
	 * Første veiing i HELE historikken. Valgfri fordi eldre kallere ikke sendte den.
	 *
	 * Den er svaret på «har du data tilbake til X?» — et spørsmål modellen tidligere
	 * besvarte med «jeg har ikke tilgang», selv om coverage sa 1 204 veiinger.
	 */
	historyStart?: string | null;
	goalKg: number | null;
	composition: {
		windowDays: number;
		fromDate: string;
		toDate: string;
		sentence: string;
		fatShare: number | null;
		weightDeltaKg: number;
		fatDeltaKg: number | null;
		muscleDeltaKg: number | null;
	} | null;
	latest: WeightDay | null;
	today: string;
}

export type WeightQueryType = 'trend' | 'milestones' | 'composition' | 'monthly' | 'declines';

/** Vinduene endringen rapporteres over. 7 er støyete alene, 90 er retningen. */
export const CHANGE_WINDOWS_DAYS = [7, 30, 90] as const;

/** Milepæler i svaret. De er rangert, så de første er de sterkeste. */
export const MAX_MILESTONES = 5;

export interface WeightChange {
	windowDays: number;
	/** Faktisk avstand til referansepunktet — sjelden nøyaktig `windowDays`. */
	actualDays: number;
	fromDate: string;
	fromTrendKg: number;
	deltaKg: number;
}

/**
 * Én deklarert form med valgfrie seksjoner, av samme grunn som i
 * `training-summary.ts`: JSON-en blir den samme, men kallstedet slipper å smalne
 * typen med en `queryType`-sjekk før det kan lese et felt.
 */
export interface WeightSummary {
	queryType: WeightQueryType;
	coverage: {
		weighIns: number;
		historyDays: number;
		/** Første veiing i hele historikken. Svaret på «har du data tilbake til X?». */
		firstWeighIn: string | null;
		enoughHistory: boolean;
		latestWeighIn: string | null;
		daysSinceLatest: number | null;
	};
	/* declines */
	declines?: WeightDecline[];
	largestDecline?: WeightDecline | null;
	fastestDecline?: WeightDecline | null;
	longestDecline?: WeightDecline | null;
	/** Snittempo over alle periodene, vektet på varighet. */
	averageKgPerWeek?: number | null;
	/* monthly */
	months?: MonthlyWeight[];
	/** Første måned med en ekte måling. Svaret på «har du data tilbake til X?». */
	measuredFrom?: string | null;
	measuredTo?: string | null;
	measuredMonths?: number;
	interpolatedMonths?: number;
	longestGapMonths?: number;
	/* trend */
	latest?: { date: string; weightKg: number; weighInCount: number } | null;
	trendKg?: number | null;
	trendDate?: string | null;
	changes?: WeightChange[];
	goal?: { goalKg: number; remainingKg: number | null; reached: boolean } | null;
	nadir?: { date: string; value: number } | null;
	topMilestone?: WeightSummaryInput['milestones'][number] | null;
	/* milestones */
	milestones?: WeightSummaryInput['milestones'];
	truncated?: boolean;
	/* composition */
	composition?: WeightSummaryInput['composition'];
	latestMeasured?: {
		date: string;
		weightKg: number;
		fatRatio: number | null;
		fatMassKg: number | null;
		muscleMassKg: number | null;
	} | null;
	missing?: string;
}

export function summarizeWeightForChat(
	input: WeightSummaryInput,
	queryType: WeightQueryType = 'trend'
): WeightSummary {
	const series = buildMetricSeries(input.days, 'weight');
	const trendPoints = series.points.filter((p): p is MetricPoint & { trend: number } => p.trend !== null);
	const latestTrend = trendPoints.at(-1) ?? null;

	const base = {
		queryType,
		coverage: {
			weighIns: input.weighIns,
			historyDays: input.historyDays,
			/**
			 * Spennet skrevet ut, ikke bare som et antall dager.
			 *
			 * «1 204 veiinger over 3 222 dager» krever at modellen regner for å svare
			 * på «har du tall fra 2014?», og en modell som må regne for å vite om den
			 * har noe, svarer gjerne at den ikke har det — og finner så på tallene.
			 * Se docs/changelog/2026-08-09-manedssnitt-vekt-og-oppdiktede-tall.md.
			 */
			firstWeighIn: input.historyStart ?? input.days[0]?.date ?? null,
			/**
			 * Rekorder krever en historikk å være rekord i. Er denne false, skal
			 * modellen ikke kalle noe «lavest noensinne».
			 */
			enoughHistory: input.enoughHistory,
			latestWeighIn: input.latest?.date ?? null,
			daysSinceLatest: input.latest ? dayNumber(input.today) - dayNumber(input.latest.date) : null
		}
	};

	if (queryType === 'declines') {
		const summary = summarizeDeclines(series.points);
		return {
			...base,
			declines: summary.declines,
			largestDecline: summary.largest,
			fastestDecline: summary.fastest,
			longestDecline: summary.longest,
			averageKgPerWeek: summary.averageKgPerWeek,
			missing:
				summary.count === 0
					? 'Ingen nedgangsperioder over terskelen i historikken.'
					: undefined
		};
	}

	if (queryType === 'monthly') {
		// Serien regnes her, aldri av modellen. Se weight-monthly.ts for hvorfor:
		// en modell uten vei til svaret finner på et, og et oppdiktet tall merket
		// «interpolert» er verre enn en åpen gjetning.
		const monthly = summarizeMonthlyWeights(input.days);
		return { ...base, ...monthly };
	}

	if (queryType === 'milestones') {
		return {
			...base,
			/**
			 * Ferdig formulerte setninger, rangert. Flaten setter ikke sammen tall
			 * selv, og modellen skal heller ikke gjøre det — den skal velge én og si
			 * den. `basis` skiller trend (sterkest) fra enkeltmåling og atferd.
			 */
			milestones: input.milestones.slice(0, MAX_MILESTONES).map((m) => ({
				kind: m.kind,
				sentence: m.sentence,
				tone: m.tone,
				basis: m.basis,
				sinceDate: m.sinceDate,
				longestGapDays: m.longestGapDays
			})),
			truncated: input.milestones.length > MAX_MILESTONES
		};
	}

	if (queryType === 'composition') {
		return {
			...base,
			/**
			 * Vekta alene kan ikke skille et vekttap man vil ha fra et man ikke vil ha.
			 * `fatShare` er IKKE garantert 0–1: falt fettet mer enn vekta fordi muskelen
			 * økte, blir den over 1. Bruk setningen framfor å formatere den som prosent.
			 */
			composition: input.composition,
			latestMeasured: input.latest
				? {
						date: input.latest.date,
						weightKg: input.latest.weightKg,
						fatRatio: input.latest.fatRatio,
						fatMassKg: input.latest.fatMassKg,
						muscleMassKg: input.latest.muscleMassKg
					}
				: null,
			missing: input.composition === null ? 'Mangler fettmåling i begge ender av vinduet.' : undefined
		};
	}

	// 'trend' — standardsvaret.
	return {
		...base,
		latest: input.latest
			? { date: input.latest.date, weightKg: input.latest.weightKg, weighInCount: input.latest.weighInCount }
			: null,
		/** Etterslepende 7-dagerssnitt. Dette er tallet et svar skal lede med. */
		trendKg: latestTrend?.trend ?? null,
		trendDate: latestTrend?.date ?? null,
		changes: latestTrend ? computeChanges(trendPoints, latestTrend) : [],
		goal: input.goalKg === null
			? null
			: {
					goalKg: input.goalKg,
					// Mot trenden, ikke mot siste måling — se modulkommentaren.
					remainingKg:
						latestTrend === null ? null : Math.round((latestTrend.trend - input.goalKg) * 10) / 10,
					reached: latestTrend !== null && latestTrend.trend <= input.goalKg
				},
		/** Laveste TRENDVERDI i historikken, ikke laveste måling. */
		nadir: series.nadir,
		/** Toppmilepælen tas med i trend-svaret også — den er ofte hele poenget. */
		topMilestone: input.milestones[0] ?? null
	};
}

/**
 * Endring i trenden over hvert vindu.
 *
 * Referansen er det siste trendpunktet på eller før datoen vinduet peker på — og
 * `actualDays` sier hvor langt tilbake det faktisk lå. Uten det ville en bruker som
 * ikke veide seg på seks uker fått «endring siste 7 dager» regnet fra en måling i
 * forrige måned, uten at noe sa fra.
 */
function computeChanges(
	trendPoints: Array<MetricPoint & { trend: number }>,
	latest: MetricPoint & { trend: number }
): WeightChange[] {
	const latestDay = dayNumber(latest.date);
	const out: WeightChange[] = [];

	for (const windowDays of CHANGE_WINDOWS_DAYS) {
		const cutoff = latestDay - windowDays;
		let reference: (MetricPoint & { trend: number }) | null = null;
		for (const point of trendPoints) {
			if (dayNumber(point.date) > cutoff) break;
			reference = point;
		}
		// Ingen måling så langt tilbake — vinduet utelates framfor å bli 0.
		if (!reference || reference.date === latest.date) continue;

		out.push({
			windowDays,
			actualDays: latestDay - dayNumber(reference.date),
			fromDate: reference.date,
			fromTrendKg: reference.trend,
			deltaKg: Math.round((latest.trend - reference.trend) * 10) / 10
		});
	}

	return out;
}
