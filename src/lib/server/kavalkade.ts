/**
 * Årskavalkade — oppsummerer et bursdagsår (fra forrige bursdag til neste).
 *
 * Rene beregningsfunksjoner uten DB-avhengighet; spørringene skjer i
 * /kavalkade sin page-server som mater radene inn hit.
 */

export interface KavalkadeWindow {
	/** Inklusiv start */
	start: Date;
	/** Eksklusiv slutt */
	end: Date;
}

export interface BirthdayWindows {
	current: KavalkadeWindow;
	previous: KavalkadeWindow;
	/** Neste bursdag (i dag eller senere), null uten kjent fødselsdato */
	nextBirthday: Date | null;
}

/**
 * Beregn årsvinduene. Med kjent fødselsdato går «i år» fra forrige bursdag
 * til neste; uten går det 365 dager bakover fra i dag.
 */
export function getBirthdayWindows(birthDate: string | null, today = new Date()): BirthdayWindows {
	const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

	const parsed = birthDate ? new Date(birthDate) : null;
	if (parsed && !Number.isNaN(parsed.getTime())) {
		let next = new Date(todayMidnight.getFullYear(), parsed.getMonth(), parsed.getDate());
		if (next < todayMidnight) {
			next = new Date(todayMidnight.getFullYear() + 1, parsed.getMonth(), parsed.getDate());
		}
		const shiftYears = (d: Date, years: number) =>
			new Date(d.getFullYear() + years, d.getMonth(), d.getDate());
		return {
			current: { start: shiftYears(next, -1), end: next },
			previous: { start: shiftYears(next, -2), end: shiftYears(next, -1) },
			nextBirthday: next
		};
	}

	const shiftYears = (d: Date, years: number) =>
		new Date(d.getFullYear() + years, d.getMonth(), d.getDate());
	return {
		current: { start: shiftYears(todayMidnight, -1), end: todayMidnight },
		previous: { start: shiftYears(todayMidnight, -2), end: shiftYears(todayMidnight, -1) },
		nextBirthday: null
	};
}

function inWindow(date: Date, window: KavalkadeWindow): boolean {
	return date >= window.start && date < window.end;
}

// ── Input-rader (generiske former av DB-radene, for testbarhet) ─────────────

export interface WorkoutDayRow {
	date: Date;
	sportFamily: string;
	count: number;
	distanceMeters: number;
	durationSeconds: number;
}

export interface MonthAggregateRow {
	startDate: Date;
	metrics: {
		steps?: { sum?: number };
		sleep?: { avg?: number }; // timer
		weight?: { avg?: number }; // kg
		screenTime?: { avgPerDayMinutes?: number };
	} | null;
}

export interface FinishedBookRow {
	title: string;
	author: string | null;
	finishedAt: Date;
}

// ── Resultat ────────────────────────────────────────────────────────────────

export interface SportSummary {
	family: string;
	count: number;
	distanceKm: number;
	durationHours: number;
}

export interface YearSummary {
	workoutCount: number;
	/** Sortert på antall økter, synkende */
	sports: SportSummary[];
	stepsTotal: number | null;
	sleepAvgHours: number | null;
	weightStartKg: number | null;
	weightEndKg: number | null;
	weightChangeKg: number | null;
	screenTimeAvgMinPerDay: number | null;
	books: Array<{ title: string; author: string | null }>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Oppsummer ett årsvindu. Månedsaggregater telles i vinduet måneden starter i —
 * grensemåneden rundt bursdagen havner altså helt i ett av årene.
 */
export function summarizeYear(
	window: KavalkadeWindow,
	input: {
		workoutDays: WorkoutDayRow[];
		months: MonthAggregateRow[];
		books: FinishedBookRow[];
	}
): YearSummary {
	const bySport = new Map<string, { count: number; meters: number; seconds: number }>();
	for (const row of input.workoutDays) {
		if (!inWindow(row.date, window)) continue;
		const entry = bySport.get(row.sportFamily) ?? { count: 0, meters: 0, seconds: 0 };
		entry.count += row.count;
		entry.meters += row.distanceMeters;
		entry.seconds += row.durationSeconds;
		bySport.set(row.sportFamily, entry);
	}
	const sports: SportSummary[] = [...bySport.entries()]
		.map(([family, e]) => ({
			family,
			count: e.count,
			distanceKm: round1(e.meters / 1000),
			durationHours: round1(e.seconds / 3600)
		}))
		.sort((a, b) => b.count - a.count);

	const months = input.months
		.filter((m) => inWindow(m.startDate, window))
		.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

	const stepSums = months
		.map((m) => m.metrics?.steps?.sum)
		.filter((v): v is number => typeof v === 'number');
	const sleepAvgs = months
		.map((m) => m.metrics?.sleep?.avg)
		.filter((v): v is number => typeof v === 'number');
	const weights = months
		.map((m) => m.metrics?.weight?.avg)
		.filter((v): v is number => typeof v === 'number');
	const screenAvgs = months
		.map((m) => m.metrics?.screenTime?.avgPerDayMinutes)
		.filter((v): v is number => typeof v === 'number');

	const weightStart = weights.length > 0 ? round1(weights[0]) : null;
	const weightEnd = weights.length > 0 ? round1(weights[weights.length - 1]) : null;

	return {
		workoutCount: sports.reduce((sum, s) => sum + s.count, 0),
		sports,
		stepsTotal: stepSums.length > 0 ? stepSums.reduce((a, b) => a + b, 0) : null,
		sleepAvgHours:
			sleepAvgs.length > 0 ? round1(sleepAvgs.reduce((a, b) => a + b, 0) / sleepAvgs.length) : null,
		weightStartKg: weightStart,
		weightEndKg: weightEnd,
		weightChangeKg:
			weightStart !== null && weightEnd !== null && weights.length > 1
				? round1(weightEnd - weightStart)
				: null,
		screenTimeAvgMinPerDay:
			screenAvgs.length > 0
				? Math.round(screenAvgs.reduce((a, b) => a + b, 0) / screenAvgs.length)
				: null,
		books: input.books
			.filter((b) => inWindow(b.finishedAt, window))
			.sort((a, b) => a.finishedAt.getTime() - b.finishedAt.getTime())
			.map((b) => ({ title: b.title, author: b.author }))
	};
}

const SPORT_LABELS: Record<string, string> = {
	running: 'løpt',
	walking: 'gått',
	hiking: 'gått på tur',
	cycling: 'syklet',
	ebike: 'syklet (el)',
	swimming: 'svømt',
	strength: 'styrketrent',
	yoga: 'yoga',
	other: 'annet'
};

export function sportLabel(family: string): string {
	return SPORT_LABELS[family] ?? family;
}

/** Kompakt tekstoppsummering av i år vs. i fjor — til AI-konteksten i intervjuets speil-steg */
export function formatKavalkadeForPrompt(current: YearSummary, previous: YearSummary): string {
	const lines: string[] = [];
	const sportLine = (s: YearSummary) =>
		s.sports
			.map((sp) => `${sportLabel(sp.family)} ${sp.distanceKm > 0 ? `${sp.distanceKm} km` : `${sp.count} økter`}`)
			.join(', ');

	lines.push(`I år: ${current.workoutCount} treningsøkter${current.sports.length ? ` (${sportLine(current)})` : ''}.`);
	lines.push(`I fjor: ${previous.workoutCount} treningsøkter${previous.sports.length ? ` (${sportLine(previous)})` : ''}.`);
	if (current.stepsTotal !== null) lines.push(`Skritt i år: ${current.stepsTotal.toLocaleString('nb-NO')}${previous.stepsTotal !== null ? ` (i fjor ${previous.stepsTotal.toLocaleString('nb-NO')})` : ''}.`);
	if (current.books.length > 0 || previous.books.length > 0) {
		lines.push(`Bøker lest i år: ${current.books.length}${current.books.length ? ` (${current.books.map((b) => b.title).join(', ')})` : ''} — i fjor ${previous.books.length}.`);
	}
	if (current.weightChangeKg !== null) {
		lines.push(`Vektendring i år: ${current.weightChangeKg > 0 ? '+' : ''}${current.weightChangeKg} kg.`);
	}
	if (current.sleepAvgHours !== null) lines.push(`Søvnsnitt i år: ${current.sleepAvgHours} t/natt.`);
	return lines.join('\n');
}
