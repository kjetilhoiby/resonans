/**
 * sick-episode.ts — henter tallene ett forløp består av.
 *
 * Ingen egne spørringer mot `sensor_events`: hver serie kommer fra den delte
 * leseren som alt eier den (`readWeightDays`, `readNightlyPhysiology`,
 * `readSleepNights`, `loadTemperature`, `readDailyActivity`,
 * `listSickLevels`). Det er hele poenget — en forløpsvisning som leste rått
 * ville svart noe annet enn Vekt-flaten og Søvn-flaten på samme dag, og da er
 * den verre enn ingen visning.
 *
 * Reglene for hvordan tallene stilles opp bor rent i
 * `$lib/domain/health/sick-episode.ts`. Denne fila gjør bare datainnhentingen
 * og velger KILDE per serie.
 */

import {
	buildEpisodeTrack,
	buildEpisodeWindow,
	buildSymptomBars,
	describeEpisode,
	describeLevelCourse,
	describeReturnSummary,
	episodeSleepByDay,
	findRelapse,
	WEIGHT_CAVEAT,
	type EpisodeTrackSpec,
	type SickEpisode
} from '$lib/domain/health/sick-episode';
import { describeSickPeriod, resolveSickPeriod } from '$lib/domain/health/sick-periods';
import {
	NORM_EXCLUDE_AFTER_DAYS,
	NORM_WINDOW_DAYS
} from '$lib/domain/health/normal-band';
import { dayKeyFromNumber } from '$lib/domain/streaks';
import { resolveSymptom } from '$lib/domain/health/symptoms';
import { buildSleepHeartRateNights } from '$lib/domain/health/sleep-heart-rate';
import { buildSleepNightSeries } from '$lib/domain/health/sleep-overview';
import { dayNumber } from '$lib/domain/streaks';
import { readWeightDays } from './weight-history';
import { readNightlyPhysiology } from './nightly-physiology';
import { readSleepNights } from '$lib/server/integrations/sleep-goals';
import { loadTemperature } from './temperature-log';
import {
	DAILY_ACTIVE_MINUTES_SOURCE_LABEL,
	DAILY_HR_SOURCE_LABEL,
	DAILY_STEPS_SOURCE_LABEL,
	readDailyActivity
} from './daily-activity';
import { listSickLevels, listSickPeriods, todayOsloKey } from './sick-log';
import { listSymptoms } from './symptom-log';

/**
 * Litt slakk på lesevinduet.
 *
 * Leserne måler bakover fra `Date.now()` i UTC, vinduet er dagsnøkler i Oslo,
 * og en `sinceDays` som treffer nøyaktig ville mistet den eldste dagen halve
 * døgnet. Samme klasse feil som `NOW_SLACK_MS` i diagnostikken.
 */
const LOOKBACK_SLACK_DAYS = 2;

/**
 * Ett forløp, ferdig stilt opp.
 *
 * Returnerer null når perioden ikke finnes for brukeren — kallstedet skal svare
 * 404, ikke tegne en tom flate.
 */
export async function loadSickEpisode(
	userId: string,
	periodId: string,
	now: Date = new Date()
): Promise<SickEpisode | null> {
	const today = todayOsloKey(now);
	const periods = await listSickPeriods(userId);
	const period = periods.find((p) => p.id === periodId);
	if (!period) return null;

	const window = buildEpisodeWindow(period, today);
	if (window.days.length === 0) return null;

	// Ett vindu for alle leserne, så ingen serie er kortere enn aksen.
	const firstDay = window.days[0]!.day;
	const windowDays = dayNumber(today) - dayNumber(firstDay) + LOOKBACK_SLACK_DAYS;
	// Normalområdet krever et halvår bak seg (`NORM_WINDOW_DAYS`), altså
	// vesentlig mer enn selve forløpet. Vi leser ÉN gang, på det lengste av de
	// to: to lesninger av de samme radene ville kostet dobbelt for ingenting.
	const lookbackDays = Math.max(windowDays, NORM_WINDOW_DAYS + LOOKBACK_SLACK_DAYS);

	const [weightDays, physiology, sleepNights, temperature, daily, levels, symptoms] =
		await Promise.all([
			readWeightDays(userId, { now }),
			readNightlyPhysiology(userId, lookbackDays),
			readSleepNights(userId, lookbackDays),
			// Temperatur er sjelden målt. Feiler den, skal ikke resten av
			// forløpet feile med den.
			loadTemperature(userId, lookbackDays).catch(() => null),
			readDailyActivity(userId, lookbackDays).catch(() => ({
				hrMin: new Map<string, number>(),
				steps: new Map<string, number>(),
				activeMinutes: new Map<string, number>()
			})),
			listSickLevels(userId, lookbackDays).catch(() => []),
			listSymptoms(userId)
		]);

	const weightByDay = new Map(weightDays.map((d) => [d.date, d.weightKg]));

	const sleepHrByDay = new Map<string, number>();
	for (const night of buildSleepHeartRateNights(physiology.heartRateRows)) {
		if (night.restingBpm !== null) sleepHrByDay.set(night.date, night.restingBpm);
	}

	// HRV kommer fra samme lesing som sovepulsen. `readNightlyPhysiology` filtrerer
	// alt bort dupper, som er nødvendig her også: en dupp og natta før deler
	// nattbøtte, og duppens HRV ville overskrevet nattas.
	const hrvByDay = new Map<string, number>();
	for (const night of physiology.hrvNights) hrvByDay.set(night.date, night.sdnnMs);

	// Dupper telles MED her, i motsetning til overalt ellers. Se
	// `episodeSleepByDay` for hvorfor: den som ligger nede sover om dagen, og
	// det er ikke støy i nattmålingen — det er sykdommen.
	const sleepByDay = episodeSleepByDay(buildSleepNightSeries(sleepNights));

	const coreByDay = new Map<string, number>();
	for (const reading of temperature?.core.readings ?? []) {
		// Flere målinger samme dag: den HØYESTE er den man husker forløpet ved,
		// og den `summarizeCoreTemperature` alt løfter fram.
		const existing = coreByDay.get(reading.date);
		if (existing === undefined || reading.celsius > existing) {
			coreByDay.set(reading.date, reading.celsius);
		}
	}

	const skinByDay = new Map<string, number>(
		(temperature?.skin.readings ?? []).map((r) => [r.date, r.celsius])
	);

	const levelByDay = new Map(levels.map((l) => [l.day, l.level]));

	/**
	 * Dagene normalområdet IKKE skal bygges av.
	 *
	 * Alle sykeperioder brukeren har registrert, pluss halen etter hver av dem
	 * (`NORM_EXCLUDE_AFTER_DAYS`). Uten dette måler forløpet seg mot et
	 * normalområde det selv har vært med på å utvide — og jo oftere man er syk,
	 * desto mindre unormalt ser sykdom ut.
	 */
	const excluded = new Set<string>();
	for (const p of periods) {
		const resolved = resolveSickPeriod(p, today);
		const from = dayNumber(resolved.startDate);
		const to = dayNumber(resolved.effectiveEnd) + NORM_EXCLUDE_AFTER_DAYS;
		for (let d = from; d <= to; d++) excluded.add(dayKeyFromNumber(d));
	}

	const normFrom = dayNumber(today) - NORM_WINDOW_DAYS;
	/** Friske verdier for én rad: i normvinduet, utenfor enhver sykeperiode. */
	const healthy = (byDay: ReadonlyMap<string, number>): number[] => {
		const out: number[] = [];
		for (const [day, value] of byDay) {
			if (excluded.has(day)) continue;
			const n = dayNumber(day);
			if (n < normFrom || n > dayNumber(today)) continue;
			out.push(value);
		}
		return out;
	};

	const specs: [EpisodeTrackSpec, Map<string, number>][] = [
		[
			{
				id: 'level',
				label: 'Hvordan det står til',
				unit: 'av 5',
				source: 'dine egne innsjekk',
				decimals: 0,
				// Nivået ER forløpet, ikke et avvik fra det. Ingen markering.
				notableDirection: null
			},
			levelByDay
		],
		[
			{
				id: 'weight',
				label: 'Vekt',
				unit: 'kg',
				source: null,
				decimals: 1,
				// Vektraden bærer forbeholdet sitt; en farge i tillegg ville lest som
				// en dom om et tall vi nettopp har sagt ikke er sammenlignbart.
				notableDirection: null
			},
			weightByDay
		],
		[
			{
				id: 'restingHr',
				label: 'Dagpuls',
				unit: 'slag/min',
				source: DAILY_HR_SOURCE_LABEL,
				decimals: 0,
				notableDirection: 'up'
			},
			daily.hrMin
		],
		[
			{
				id: 'sleepHr',
				label: 'Sovepuls',
				unit: 'slag/min',
				source: 'laveste puls gjennom natta',
				decimals: 0,
				notableDirection: 'up'
			},
			sleepHrByDay
		],
		[
			{
				id: 'hrv',
				label: 'HRV',
				unit: 'ms',
				source: 'SDNN gjennom natta',
				decimals: 0,
				// Fallet er signalet, ikke stigningen — motsatt av sovepuls.
				notableDirection: 'down',
				/**
				 * SDNN sier ingenting alene.
				 *
				 * «Absoluttverdien vises ALDRI alene» er regelen fra `hrv.ts`: tallet
				 * varierer for mye mellom folk, og det finnes ingen normtabell. Flagget
				 * håndhever den mekanisk — uten baseline sier raden det, framfor å
				 * skrive «42 ms» som om det betydde noe i seg selv.
				 */
				absoluteIsMeaningless: true
			},
			hrvByDay
		],
		[
			{
				id: 'sleep',
				label: 'Søvn',
				unit: 't',
				// Kilden må navngis her selv om det bare finnes én: tallet er tid
				// SOVET, ikke tid i senga, og det avviket (en til to timer) ser ut
				// som en feil hos den som teller timene sine selv.
				source: 'tid sovet i døgnet, dupper inkludert',
				decimals: 1,
				notableDirection: 'down'
			},
			sleepByDay
		],
		[
			{
				id: 'steps',
				label: 'Skritt',
				unit: 'skritt',
				source: DAILY_STEPS_SOURCE_LABEL,
				decimals: 0,
				// Bevegelsen som forsvant er det brukeren selv la merke til først.
				notableDirection: 'down',
				// Telleren går fortsatt i dag. Se `accumulates`.
				accumulates: true
			},
			daily.steps
		],
		[
			{
				id: 'activeMinutes',
				label: 'Aktive minutter',
				unit: 'min',
				source: DAILY_ACTIVE_MINUTES_SOURCE_LABEL,
				decimals: 0,
				notableDirection: 'down',
				accumulates: true
			},
			daily.activeMinutes
		],
		[
			{
				id: 'coreTemperature',
				label: 'Temperatur',
				unit: '°C',
				source: 'termometer',
				decimals: 1,
				notableDirection: 'up'
			},
			coreByDay
		],
		[
			{
				id: 'skinTemperature',
				label: 'Hudtemperatur',
				unit: '°C',
				source: 'klokka',
				decimals: 1,
				notableDirection: 'up',
				// Se flagget: håndleddstallet har ingen normtabell, så raden viser
				// bare avviket fra dagene før.
				absoluteIsMeaningless: true
			},
			skinByDay
		]
	];

	const tracks = specs
		.map(([spec, byDay]) => buildEpisodeTrack(spec, byDay, window, healthy(byDay)))
		// En rad uten en eneste måling i forløpet er ikke et hull å forklare —
		// den er en sensor brukeren ikke har. Et tomt spor ser ut som en feil.
		.filter((track) => track.measuredSickDays > 0 || track.baselineSamples > 0);

	const resolvedSymptoms = symptoms.map((s) => resolveSymptom(s, today));
	const levelsInWindow = levels.filter(
		(l) => l.day >= firstDay && l.day <= window.days[window.days.length - 1]!.day
	);
	const resolvedPeriod = resolveSickPeriod(period, today);

	return {
		period: { ...resolvedPeriod, text: describeSickPeriod(resolvedPeriod) },
		window,
		headline: describeEpisode(window, period.startDate),
		tracks,
		symptoms: buildSymptomBars(resolvedSymptoms, window),
		levels: levelsInWindow,
		levelText: describeLevelCourse(levelsInWindow),
		relapse: findRelapse(levelsInWindow),
		returnSummary: describeReturnSummary(tracks),
		weightCaveat: WEIGHT_CAVEAT
	};
}

/** Beholdt som navn kallstedene alt bruker; formen bor i domenelaget. */
export type { SickEpisode };
