/**
 * UI-typer for kavalkade-komponentene — speiler server-summariene fra
 * $lib/server/kavalkade-data (som er server-only og ikke kan importeres her).
 */

export interface LabeledSport {
	family: string;
	label: string;
	count: number;
	distanceKm: number;
	durationHours: number;
}

export interface YearData {
	workoutCount: number;
	sports: LabeledSport[];
	stepsTotal: number | null;
	sleepAvgHours: number | null;
	weightStartKg: number | null;
	weightEndKg: number | null;
	weightChangeKg: number | null;
	screenTimeAvgMinPerDay: number | null;
	books: Array<{ title: string; author: string | null }>;
}

export interface MonthEntry {
	key: string;
	label: string;
	workoutCount: number;
	topSport: { family: string; label: string; distanceKm: number; count: number } | null;
	stepsTotal: number | null;
	books: string[];
	headline: string | null;
}

export interface OrdskyWordView {
	word: string;
	count: number;
	weight: number;
}

export interface Greeting {
	character: string;
	book: string;
	text: string;
}

export interface PhotoView {
	url: string;
	caption: string;
}

export interface LoopPromiseView {
	title: string;
	targetValue: number | null;
	unit: string | null;
	actualValue: number | null;
	achieved: boolean | null;
	status: string;
}

export interface LoopView {
	hasData: boolean;
	promises: LoopPromiseView[];
	prophecyExcerpt: string | null;
}

export function timelineHasContent(months: MonthEntry[]): boolean {
	return months.some(
		(m) => m.workoutCount > 0 || m.stepsTotal !== null || m.books.length > 0 || !!m.headline
	);
}
