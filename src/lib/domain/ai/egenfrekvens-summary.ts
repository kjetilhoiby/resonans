/**
 * Egenfrekvens-dashboardet oversatt til noe en modell kan svare ut fra.
 *
 * Innsjekkene lå i `loadEgenfrekvensDashboardData` med én kaller, så chatten
 * kunne ikke se dem i det hele tatt: det finnes ingen `query_sensor_data`-metrikk
 * for `egenfrekvens_checkin`. På «hvordan har uka mi vært?» hadde modellen
 * ingenting — i det domenet der brukeren har skrevet mest selv.
 *
 * ## Tallene får brukerens egne ord med seg
 *
 * Balanse går fra −5 til 5, og «−3» betyr ingenting uten skalaen. Brukeren har
 * valgt på en slider merket «Underskudd», så sammendraget bærer `BALANCE_LABELS`
 * med. Uten det ville modellen laget sin egen tolkning av tallet, i en samtale
 * der ordvalget er hele poenget.
 *
 * ## Refleksjonene forkortes, ikke utelates
 *
 * Fulle refleksjonstråder er det lengste fritekstmaterialet i basen, og en tråd
 * per dag over tretti dager sprenger konteksten. `reflectionSynthesis` er
 * sammendraget som alt finnes; rå notater klippes til `MAX_NOTE_CHARS` med
 * `noteTruncated` satt, så modellen vet at det står mer og kan spørre.
 */

import { BALANCE_LABELS } from '$lib/domains/egenfrekvens';
import { PERIOD_SLOTS, type PeriodSlotId } from '$lib/domains/egenfrekvens/period-slots';

export interface EgenfrekvensSummaryInput {
	rangeDays: number;
	latest: EgenfrekvensPointInput | null;
	/** Nyeste dag først. */
	points: EgenfrekvensPointInput[];
	stats: {
		count: number;
		avgBalance: number | null;
		avgLevel: number | null;
		avgThoughts: number | null;
		avgFeelings: number | null;
		avgActions: number | null;
		avgLevelBySlot: Record<PeriodSlotId, number | null>;
		extremeDays: number;
	};
	streakDays: number;
}

interface EgenfrekvensSlotInput {
	level: number | null;
	balance: number | null;
	note: string | null;
	reflectionSynthesis: string | null;
	timestamp: string;
}

interface EgenfrekvensPointInput {
	day: string;
	count: number;
	balance: number | null;
	thoughts: number | null;
	feelings: number | null;
	actions: number | null;
	note: string | null;
	reflectionSynthesis: string | null;
	extreme: boolean;
	slots: Partial<Record<PeriodSlotId, EgenfrekvensSlotInput>>;
}

export type EgenfrekvensQueryType = 'recent' | 'trend' | 'latest';

/** Dager i `recent`. To uker er nok å se et mønster i. */
export const MAX_DAYS = 14;

/** Fritekst klippes her. Nok til å kjenne igjen dagen, ikke nok til å fylle konteksten. */
export const MAX_NOTE_CHARS = 280;

/**
 * Én deklarert form med valgfrie seksjoner, av samme grunn som i
 * `training-summary.ts`: samme JSON, men kallstedet slipper å smalne typen først.
 */
export interface EgenfrekvensSummary {
	queryType: EgenfrekvensQueryType;
	coverage: { rangeDays: number; daysWithCheckin: number; streakDays: number; extremeDays: number };
	scales: { balance: string; level: string };
	/* latest */
	latest?: ReturnType<typeof describeDay> | null;
	/* recent */
	days?: Array<ReturnType<typeof describeDay>>;
	truncated?: boolean;
	/* trend */
	averages?: {
		balance: number | null;
		balanceLabel: string | null;
		level: number | null;
		thoughts: number | null;
		feelings: number | null;
		actions: number | null;
	};
	byPeriod?: Array<{ slot: PeriodSlotId; label: string; avgLevel: number | null }>;
	/**
	 * Dagene i trend-svaret: bare nivå, balanse og ytterdag. Eget feltnavn framfor
	 * `days`, siden radene har andre felt enn de fulle dagene i `recent` — samme navn
	 * på to former gjør svaret uleselig for både modell og kallsted.
	 */
	dayLevels?: TrendDay[];
}

interface TrendDay {
	day: string;
	balance: number | null;
	level: number | null;
	extreme: boolean;
}

export function summarizeEgenfrekvensForChat(
	input: EgenfrekvensSummaryInput,
	queryType: EgenfrekvensQueryType = 'recent'
): EgenfrekvensSummary {
	const base = {
		queryType,
		coverage: {
			rangeDays: input.rangeDays,
			daysWithCheckin: input.stats.count,
			/** Dager på rad med innsjekk, fram til i dag. Atferd, ikke tilstand. */
			streakDays: input.streakDays,
			/** Innsjekk som ble merket som en ytterdag. */
			extremeDays: input.stats.extremeDays
		},
		scales: {
			balance: 'Balanse −5 til 5, der 0 er nøytralt. Bruk brukerens egen merkelapp, ikke tallet alene.',
			level: 'Nivå 1–5 per periode (natt/morgen/arbeidsdag/ettermiddag/kveld), høyere er bedre.'
		}
	};

	if (queryType === 'latest') {
		return { ...base, latest: input.latest ? describeDay(input.latest, { withSlots: true }) : null };
	}

	if (queryType === 'trend') {
		return {
			...base,
			averages: {
				balance: round1(input.stats.avgBalance),
				balanceLabel: labelForBalance(input.stats.avgBalance),
				level: round1(input.stats.avgLevel),
				thoughts: round1(input.stats.avgThoughts),
				feelings: round1(input.stats.avgFeelings),
				actions: round1(input.stats.avgActions)
			},
			/**
			 * Snitt per periode av døgnet. Det er her et mønster faktisk vises —
			 * «morgenene er tunge, kveldene er greie» er et annet råd enn et lavt
			 * dagssnitt. Slots uten innsjekk utelates framfor å bli 0.
			 */
			byPeriod: PERIOD_SLOTS.map((slot) => ({
				slot: slot.id,
				label: slot.shortLabel,
				avgLevel: round1(input.stats.avgLevelBySlot[slot.id] ?? null)
			})).filter((row) => row.avgLevel !== null),
			dayLevels: input.points.slice(0, MAX_DAYS).map((point) => ({
				day: point.day,
				balance: point.balance === null ? null : round1(point.balance),
				level: highestSlotLevel(point),
				extreme: point.extreme
			}))
		};
	}

	// 'recent' — standardsvaret: dagene med det brukeren selv skrev.
	return {
		...base,
		days: input.points.slice(0, MAX_DAYS).map((point) => describeDay(point, { withSlots: false })),
		truncated: input.points.length > MAX_DAYS
	};
}

function describeDay(point: EgenfrekvensPointInput, opts: { withSlots: boolean }) {
	const note = truncate(point.note);

	return {
		day: point.day,
		checkins: point.count,
		balance: point.balance === null ? null : round1(point.balance),
		balanceLabel: labelForBalance(point.balance),
		thoughts: round1(point.thoughts),
		feelings: round1(point.feelings),
		actions: round1(point.actions),
		extreme: point.extreme,
		note: note.text,
		noteTruncated: note.truncated,
		/** Sammendraget av refleksjonstråden — ikke tråden selv. Se modulkommentaren. */
		reflectionSynthesis: truncate(point.reflectionSynthesis).text,
		slots: opts.withSlots
			? Object.entries(point.slots)
					.map(([id, slot]) => ({
						slot: id,
						level: slot?.level ?? null,
						balance: slot?.balance ?? null,
						balanceLabel: labelForBalance(slot?.balance ?? null),
						note: truncate(slot?.note ?? null).text,
						at: slot?.timestamp ?? null
					}))
					.filter((row) => row.level !== null || row.balance !== null || row.note !== null)
			: undefined
	};
}

/**
 * Dagens høyeste slot-nivå.
 *
 * Snitt over slots ville jevnet ut nettopp det som er interessant: en morgen på 2
 * og en kveld på 5 er ikke «en 3,5-dag». Trend-listen viser toppen, og
 * `byPeriod` bærer mønsteret.
 */
function highestSlotLevel(point: EgenfrekvensPointInput): number | null {
	const levels = Object.values(point.slots)
		.map((slot) => slot?.level ?? null)
		.filter((level): level is number => level !== null);
	return levels.length > 0 ? Math.max(...levels) : null;
}

function labelForBalance(value: number | null): string | null {
	if (value === null) return null;
	// Snittet er sjelden et heltall; merkelappen er den nærmeste på skalaen.
	return BALANCE_LABELS[Math.round(value)] ?? null;
}

function truncate(text: string | null): { text: string | null; truncated: boolean } {
	if (text === null) return { text: null, truncated: false };
	const trimmed = text.trim();
	if (trimmed.length <= MAX_NOTE_CHARS) return { text: trimmed || null, truncated: false };
	return { text: `${trimmed.slice(0, MAX_NOTE_CHARS)}…`, truncated: true };
}

function round1(value: number | null): number | null {
	return value === null ? null : Math.round(value * 10) / 10;
}
