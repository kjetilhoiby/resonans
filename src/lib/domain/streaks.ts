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
	/**
	 * consecutive_days / count_per_window: hvor lang én pause kan være uten å bryte
	 * streaken, målt i enheter (dager, eller perioder for count_per_window).
	 * Default 0 = ingen toleranse.
	 */
	maxGapDays?: number;
	/**
	 * Hvor mange pauser som tolereres i hele den aktive rekka. Default 1 når
	 * `maxGapDays` er satt. Bevisst per rekke, ikke per tidsvindu.
	 */
	maxGaps?: number;
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
	/** Antall tolererte pauser inni den aktive streaken. 0 = ubrutt. */
	gapCount: number;
	/** Totalt antall enheter hoppet over i pausene (dager, eller perioder). */
	gapUnits: number;
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

interface Run {
	/** Antall enheter (dager/perioder) i den aktive rekka. */
	count: number;
	/** Antall pauser inni rekka. */
	gapCount: number;
	/** Totalt antall enheter hoppet over i pausene. */
	gapUnits: number;
}

const NO_RUN: Run = { count: 0, gapCount: 0, gapUnits: 0 };

/**
 * Finn den aktive rekka bakover fra inneværende enhet, med toleranse for korte
 * pauser.
 *
 * `current` er dagen/perioden som er i arbeid — mangler den, teller den ikke som
 * en pause (du har fortsatt tid igjen). Rekka starter derfor på nyeste
 * tilstedeværende enhet, og avstanden derfra til `current` behandles som en
 * allerede forbigått pause.
 *
 * Med `maxGapUnits: 0` (standard) er dette identisk med streng telling: første
 * hull avslutter rekka.
 *
 * `maxGaps` teller pauser i hele den aktive rekka, ikke per tidsvindu — bevisst
 * enkelt og forutsigbart framfor «én pause per 30 dager».
 */
function findRun(
	present: Set<number>,
	current: number,
	maxGapUnits: number,
	maxGaps: number
): Run {
	const currentDone = present.has(current);

	// Nyeste tilstedeværende enhet til og med inneværende.
	let last = -Infinity;
	if (currentDone) {
		last = current;
	} else {
		for (const unit of present) {
			if (unit < current && unit > last) last = unit;
		}
	}
	if (!Number.isFinite(last)) return NO_RUN;

	let gapCount = 0;
	let gapUnits = 0;
	let budget = maxGaps;

	// Enhetene mellom siste registrering og inneværende er ferdig forbigått.
	const missedBefore = currentDone ? 0 : current - 1 - last;
	if (missedBefore > 0) {
		if (missedBefore > maxGapUnits || budget < 1) return NO_RUN;
		gapCount = 1;
		gapUnits = missedBefore;
		budget -= 1;
	}

	let count = 0;
	let cursor = last;
	while (true) {
		if (present.has(cursor)) {
			count++;
			cursor--;
			continue;
		}
		if (budget < 1 || maxGapUnits < 1) break;
		// Hvor langt er hullet? Sonder bakover innenfor det tolererte.
		let gap = 0;
		let probe = cursor;
		while (gap < maxGapUnits && !present.has(probe)) {
			gap++;
			probe--;
		}
		if (!present.has(probe)) break; // hullet er for langt — rekka slutter her
		gapCount++;
		gapUnits += gap;
		budget -= 1;
		cursor = probe;
	}

	return { count, gapCount, gapUnits };
}

/** Toleranse-parametre for en regel, med standardverdier. */
function graceFrom(config: StreakConfig): { maxGapUnits: number; maxGaps: number } {
	const maxGapUnits = Math.max(0, config.maxGapDays ?? 0);
	// Én pause er standard når toleranse først er slått på.
	const maxGaps = maxGapUnits > 0 ? Math.max(1, config.maxGaps ?? 1) : 0;
	return { maxGapUnits, maxGaps };
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
		daysUntilDue: null,
		gapCount: 0,
		gapUnits: 0
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
			return computeConsecutiveDays(def.config, eventDayKeys, todayKey);
		case 'count_per_window':
			return computeCountPerWindow(def.config, eventDayKeys, todayKey);
		case 'max_interval':
			return computeMaxInterval(def.config, eventDayKeys, todayKey);
	}
}

function computeConsecutiveDays(
	config: StreakConfig,
	eventDayKeys: string[],
	todayKey: string
): StreakState {
	if (eventDayKeys.length === 0) return emptyState('day');

	const today = dayNumber(todayKey);
	const days = new Set(eventDayKeys.map(dayNumber));
	const { maxGapUnits, maxGaps } = graceFrom(config);

	// Dagen er ikke over: mangler dagens hendelse, regnes den ikke som en pause.
	const doneToday = days.has(today);
	const run = findRun(days, today, maxGapUnits, maxGaps);

	return {
		count: run.count,
		unit: 'day',
		// bestCount er strengt sammenhengende — aldri lavere enn dagens tolererte rekke.
		bestCount: Math.max(longestRun(days), run.count),
		lastEventDay: dayKeyFromNumber(Math.max(...days)),
		dots: dotsEndingAt(days, today),
		status: run.count === 0 ? 'idle' : doneToday ? 'ok' : 'due_soon',
		windowCount: null,
		windowTarget: null,
		nextDueDay: null,
		daysUntilDue: null,
		gapCount: run.gapCount,
		gapUnits: run.gapUnits
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
	const { maxGapUnits, maxGaps } = graceFrom(config);

	// Perioden er ikke over: er terskelen ikke nådd ennå, regnes den ikke som pause.
	const run = findRun(met, currentWindow, maxGapUnits, maxGaps);

	return {
		count: run.count,
		unit,
		bestCount: Math.max(longestRun(met), run.count),
		lastEventDay: dayKeyFromNumber(latestDay),
		dots: dotsEndingAt(met, currentWindow),
		status: run.count === 0 && !currentMet ? 'idle' : currentMet ? 'ok' : 'due_soon',
		windowCount,
		windowTarget: threshold,
		nextDueDay: null,
		daysUntilDue: null,
		gapCount: run.gapCount,
		gapUnits: run.gapUnits
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
		daysUntilDue,
		// Intervallet ER toleransen her, så pauser er ikke et eget begrep.
		gapCount: 0,
		gapUnits: 0
	};
}

const UNIT_LABEL: Record<StreakUnit, [singular: string, plural: string]> = {
	day: ['dag', 'dager'],
	week: ['uke', 'uker'],
	round: ['runde', 'runder']
};

/**
 * «6 dager på rad», «3 uker på rad», «5 runder på rad» — tom streng når streaken
 * er brutt.
 *
 * Er rekka holdt gjennom tolererte pauser, sies det rett ut:
 * «14 dager på rad (1 pause, 2 dager)». Pausen skjules ikke — «på rad» blir litt
 * mindre bokstavelig, og da skal teksten være ærlig om hvorfor.
 */
export function streakLabel(
	state: Pick<StreakState, 'count' | 'unit'> & Partial<Pick<StreakState, 'gapCount' | 'gapUnits'>>
): string {
	if (state.count <= 0) return '';
	const [singular, plural] = UNIT_LABEL[state.unit];
	const base = `${state.count} ${state.count === 1 ? singular : plural} på rad`;

	const gapCount = state.gapCount ?? 0;
	if (gapCount === 0) return base;

	const gapUnits = state.gapUnits ?? 0;
	const pauses = `${gapCount} ${gapCount === 1 ? 'pause' : 'pauser'}`;
	const skipped = `${gapUnits} ${gapUnits === 1 ? singular : plural}`;
	return `${base} (${pauses}, ${skipped})`;
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
