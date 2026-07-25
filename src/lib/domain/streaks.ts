/**
 * streaks.ts — Ren logikk for streaks: «hvor mange runder på rad har jeg holdt?»
 *
 * Én modell dekker tre semantikker, så alle streaks kan vises med samme visuelle
 * språk (flamme + teller) i stedet for hver sin widget:
 *
 *   consecutive_days   dager på rad med hendelse        «yoga 6 dager på rad»
 *   count_per_window   perioder på rad over en terskel  «3 uker på rad med ≥2 løpeturer»
 *   max_interval       runder på rad innen et intervall  «5 hårklipp på rad innen 5 dager»
 *
 * `max_interval` er periodisk vedlikehold (hårklipp, badevask). Det er bevisst
 * modellert som en streak, ikke en nedtellingsklokke: du blir belønnet for å holde
 * kadensen, på samme måte som for yoga. Forfallsinformasjonen (`daysUntilDue`,
 * `status`) brukes til å løfte oppgaven frem på ukeplanen *før* streaken brytes —
 * altså som streakens forsvar, ikke som mas.
 *
 * Modulen er DB-fri og tar imot ferdig utregnede dagsnøkler ('YYYY-MM-DD'), slik at
 * kallstedet eier tidssonevalget (Oslo-lokal dag for vaner). Duplikater i input
 * bevares — hver regel bestemmer selv om to hendelser samme dag teller som én:
 * to løpeturer samme dag teller som to mot en ukesterskel, men to hårklipp samme
 * dag er én runde.
 */

export type StreakRule = 'consecutive_days' | 'count_per_window' | 'max_interval';

/** Hvor hendelsene hentes fra. Tolkes av streak-service, ikke av denne modulen. */
export type StreakSource =
	| { kind: 'workout'; sportFamily: string }
	| { kind: 'sensor_event'; dataType: string; textMatch?: string }
	| { kind: 'manual' };

export interface StreakConfig {
	/** count_per_window: periodens længde i dager (7 = uke, Mandags-justert). Default 7. */
	windowDays?: number;
	/** count_per_window: hvor mange hendelser som kreves per periode. Default 1. */
	threshold?: number;
	/** max_interval: maks antall dager mellom to runder. */
	intervalDays?: number;
	/** max_interval: hvor mange dager før forfall den skal varsles som «snart». */
	dueSoonDays?: number;
}

export interface StreakDefinitionLike {
	rule: StreakRule;
	config: StreakConfig;
}

/** Hva teller vi «på rad» av? Styrer etiketten i UI. */
export type StreakUnit = 'day' | 'week' | 'round';

export type StreakStatus =
	/** Alt i rute — ingenting kreves akkurat nå. */
	| 'ok'
	/** Streaken lever, men noe må gjøres snart for å holde den. */
	| 'due_soon'
	/** Fristen er passert — streaken er brutt. */
	| 'overdue'
	/** Ingen hendelser ennå. */
	| 'idle';

export interface StreakState {
	/** Antall runder på rad nå. 0 = ingen aktiv streak. */
	count: number;
	unit: StreakUnit;
	/** Beste streak observert i datagrunnlaget — så historikk ikke føles tapt ved brudd. */
	bestCount: number;
	lastEventDay: string | null;
	/** Prikker for UI: eldste først, true = runde holdt. Maks 7. */
	dots: boolean[];
	status: StreakStatus;
	/** count_per_window: hendelser i inneværende periode (f.eks. 1 av 2 løpeturer). */
	windowCount: number | null;
	/** count_per_window: terskelen `windowCount` måles mot. */
	windowTarget: number | null;
	/** max_interval: dagsnøkkel for når neste runde forfaller. */
	nextDueDay: string | null;
	/** max_interval: dager til forfall. Negativt = passert. */
	daysUntilDue: number | null;
}

const DOT_COUNT = 7;
/** 1970-01-05 var en mandag — anker for periode-inndeling. */
const MONDAY_ANCHOR = 4;

/** Dager siden epoke for en 'YYYY-MM-DD'-nøkkel. Manuell parse for å unngå tidssone-drift. */
export function dayNumber(key: string): number {
	const [y, m, d] = key.split('-').map(Number);
	return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Omvendt av `dayNumber`. */
export function dayKeyFromNumber(n: number): string {
	return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Periode-indeks for en dag. Justert mot mandag, så `windowDays: 7` gir
 * kalenderuker (mandag–søndag) og ikke et rullerende vindu som flytter seg
 * hver dag — «uker på rad» skal betyde det samme for brukeren som for koden.
 */
function windowIndex(dayNum: number, windowDays: number): number {
	return Math.floor((dayNum - MONDAY_ANCHOR) / windowDays);
}

/** Lengste sammenhengende rekke av tall i et sett (brukt for bestCount). */
function longestRun(present: Set<number>): number {
	if (present.size === 0) return 0;
	const sorted = [...present].sort((a, b) => a - b);
	let best = 1;
	let run = 1;
	for (let i = 1; i < sorted.length; i++) {
		run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
		if (run > best) best = run;
	}
	return best;
}

/** Tell sammenhengende medlemskap bakover fra `start`. */
function countBack(present: Set<number>, start: number): number {
	let count = 0;
	let cursor = start;
	while (present.has(cursor)) {
		count++;
		cursor--;
	}
	return count;
}

/** Prikker for de siste `DOT_COUNT` indeksene som ender på `end`, eldste først. */
function dotsEndingAt(present: Set<number>, end: number): boolean[] {
	const dots: boolean[] = [];
	for (let i = DOT_COUNT - 1; i >= 0; i--) dots.push(present.has(end - i));
	return dots;
}

function emptyState(unit: StreakUnit): StreakState {
	return {
		count: 0,
		unit,
		bestCount: 0,
		lastEventDay: null,
		dots: Array(DOT_COUNT).fill(false),
		status: 'idle',
		windowCount: null,
		windowTarget: null,
		nextDueDay: null,
		daysUntilDue: null
	};
}

/**
 * Beregn streak-tilstand.
 *
 * @param def          regel + parametre
 * @param eventDayKeys dagsnøkler for hendelser ('YYYY-MM-DD'), usortert, duplikater bevart
 * @param todayKey     dagens dagsnøkkel i brukerens tidssone
 */
export function computeStreak(
	def: StreakDefinitionLike,
	eventDayKeys: string[],
	todayKey: string
): StreakState {
	switch (def.rule) {
		case 'consecutive_days':
			return computeConsecutiveDays(eventDayKeys, todayKey);
		case 'count_per_window':
			return computeCountPerWindow(def.config, eventDayKeys, todayKey);
		case 'max_interval':
			return computeMaxInterval(def.config, eventDayKeys, todayKey);
	}
}

function computeConsecutiveDays(eventDayKeys: string[], todayKey: string): StreakState {
	if (eventDayKeys.length === 0) return emptyState('day');

	const today = dayNumber(todayKey);
	const days = new Set(eventDayKeys.map(dayNumber));

	// Dagen er ikke over: mangler dagens hendelse, teller vi fra i går slik at
	// streaken ikke ser brutt ut midt på dagen.
	const doneToday = days.has(today);
	const count = doneToday ? countBack(days, today) : countBack(days, today - 1);

	const lastEventDay = dayKeyFromNumber(Math.max(...days));

	return {
		count,
		unit: 'day',
		bestCount: Math.max(longestRun(days), count),
		lastEventDay,
		dots: dotsEndingAt(days, today),
		status: count === 0 ? 'idle' : doneToday ? 'ok' : 'due_soon',
		windowCount: null,
		windowTarget: null,
		nextDueDay: null,
		daysUntilDue: null
	};
}

function computeCountPerWindow(
	config: StreakConfig,
	eventDayKeys: string[],
	todayKey: string
): StreakState {
	const windowDays = Math.max(1, config.windowDays ?? 7);
	const threshold = Math.max(1, config.threshold ?? 1);
	const unit: StreakUnit = windowDays === 7 ? 'week' : 'round';

	if (eventDayKeys.length === 0) {
		const empty = emptyState(unit);
		return { ...empty, windowCount: 0, windowTarget: threshold };
	}

	const today = dayNumber(todayKey);
	const currentWindow = windowIndex(today, windowDays);

	// Hendelser per periode — duplikater teller (to løpeturer samme dag = to).
	const perWindow = new Map<number, number>();
	let latestDay = -Infinity;
	for (const key of eventDayKeys) {
		const dn = dayNumber(key);
		if (dn > latestDay) latestDay = dn;
		const idx = windowIndex(dn, windowDays);
		perWindow.set(idx, (perWindow.get(idx) ?? 0) + 1);
	}

	const met = new Set([...perWindow.entries()].filter(([, n]) => n >= threshold).map(([i]) => i));
	const windowCount = perWindow.get(currentWindow) ?? 0;
	const currentMet = windowCount >= threshold;

	// Perioden er ikke over: er terskelen ikke nådd ennå, teller vi fra forrige
	// periode så en uke i arbeid ikke framstår som et brudd.
	const count = currentMet ? countBack(met, currentWindow) : countBack(met, currentWindow - 1);

	return {
		count,
		unit,
		bestCount: Math.max(longestRun(met), count),
		lastEventDay: dayKeyFromNumber(latestDay),
		dots: dotsEndingAt(met, currentWindow),
		status: count === 0 && !currentMet ? 'idle' : currentMet ? 'ok' : 'due_soon',
		windowCount,
		windowTarget: threshold,
		nextDueDay: null,
		daysUntilDue: null
	};
}

function computeMaxInterval(
	config: StreakConfig,
	eventDayKeys: string[],
	todayKey: string
): StreakState {
	const intervalDays = Math.max(1, config.intervalDays ?? 1);
	// Varsle i god tid, men skalert etter intervallet: 5 dager → 2, 14 dager → 5.
	const dueSoonDays = Math.max(1, config.dueSoonDays ?? Math.ceil(intervalDays / 3));

	if (eventDayKeys.length === 0) return emptyState('round');

	const today = dayNumber(todayKey);
	// To runder samme dag er én runde.
	const rounds = [...new Set(eventDayKeys.map(dayNumber))].sort((a, b) => a - b);

	const lastRound = rounds[rounds.length - 1];
	const nextDue = lastRound + intervalDays;
	const daysUntilDue = nextDue - today;

	// Runder på rad bakover, så lenge hvert gap holdt intervallet.
	let count = 1;
	for (let i = rounds.length - 1; i > 0; i--) {
		if (rounds[i] - rounds[i - 1] > intervalDays) break;
		count++;
	}

	// Beste rekke historisk — samme regel, men over hele serien.
	let bestCount = 1;
	let run = 1;
	for (let i = 1; i < rounds.length; i++) {
		run = rounds[i] - rounds[i - 1] <= intervalDays ? run + 1 : 1;
		if (run > bestCount) bestCount = run;
	}

	// Fristen er passert: streaken er brutt. Historikken beholdes i bestCount.
	const overdue = daysUntilDue < 0;
	if (overdue) count = 0;

	// Prikker: siste runder, true når gapet inn til runden holdt intervallet.
	const recent = rounds.slice(-DOT_COUNT);
	const dots = recent.map((day, i) => {
		if (i === 0) {
			const globalIdx = rounds.length - recent.length;
			return globalIdx === 0 || day - rounds[globalIdx - 1] <= intervalDays;
		}
		return day - recent[i - 1] <= intervalDays;
	});

	return {
		count,
		unit: 'round',
		bestCount: Math.max(bestCount, count),
		lastEventDay: dayKeyFromNumber(lastRound),
		dots,
		status: overdue ? 'overdue' : daysUntilDue <= dueSoonDays ? 'due_soon' : 'ok',
		windowCount: null,
		windowTarget: null,
		nextDueDay: dayKeyFromNumber(nextDue),
		daysUntilDue
	};
}

const UNIT_LABEL: Record<StreakUnit, [singular: string, plural: string]> = {
	day: ['dag', 'dager'],
	week: ['uke', 'uker'],
	round: ['runde', 'runder']
};

/** «6 dager på rad», «3 uker på rad», «5 runder på rad» — tom streng når streaken er brutt. */
export function streakLabel(state: Pick<StreakState, 'count' | 'unit'>): string {
	if (state.count <= 0) return '';
	const [singular, plural] = UNIT_LABEL[state.unit];
	return `${state.count} ${state.count === 1 ? singular : plural} på rad`;
}

/**
 * Kort forfallstekst for periodisk vedlikehold: «forfaller i dag», «om 3 dager»,
 * «2 dager på overtid». Null for regler uten forfall.
 */
export function dueLabel(state: Pick<StreakState, 'daysUntilDue'>): string | null {
	const days = state.daysUntilDue;
	if (days == null) return null;
	if (days < 0) {
		const overdue = Math.abs(days);
		return `${overdue} ${overdue === 1 ? 'dag' : 'dager'} på overtid`;
	}
	if (days === 0) return 'forfaller i dag';
	if (days === 1) return 'forfaller i morgen';
	return `forfaller om ${days} dager`;
}

/**
 * Sekundærtekst under streak-telleren — hva som kreves akkurat nå. Holder
 * UI-komponentene fri for regel-kunnskap.
 */
export function streakSublabel(state: StreakState): string | null {
	if (state.daysUntilDue != null) return dueLabel(state);
	if (state.windowTarget != null) {
		const done = state.windowCount ?? 0;
		return `${done}/${state.windowTarget} ${state.unit === 'week' ? 'denne uka' : 'denne perioden'}`;
	}
	if (state.status === 'due_soon') return 'gjenstår i dag';
	if (state.status === 'idle') return 'ikke startet';
	return null;
}
