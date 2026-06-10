/**
 * rescuetime-parser.ts
 *
 * Ren parsing av RescueTime Analytic Data API-svar — ingen IO, testbar.
 *
 * API-et (perspective=interval, resolution_time=hour, restrict_kind=activity)
 * gir rader på formen [dato, sekunder, antall_personer, aktivitet, kategori,
 * produktivitet] der produktivitet er -2..2 (RescueTimes egen skala).
 *
 * Fase 1 skiller ikke jobb- og hobby-koding — kveldsvinduet (fra kl. 17) og
 * kategorifordelingen er nok til kveldsjobbing-signalet. Tittel-klassifisering
 * (restrict_kind=document) er tenkt som fase 2.
 */

/** [date, time_spent_seconds, number_of_people, activity, category, productivity] */
export type RescueTimeApiRow = [string, number, number, string, string, number];

export interface CategorySeconds {
	category: string;
	seconds: number;
}

export interface RescueTimeDayData {
	dateISO: string;
	totalSeconds: number;
	/** Sekunder med produktivitet > 0 (RescueTimes skala) */
	productiveSeconds: number;
	/** Sekunder med produktivitet < 0 */
	distractingSeconds: number;
	byCategory: CategorySeconds[];
	topActivities: Array<{ activity: string; category: string; seconds: number }>;
	/** Bare timer med aktivitet, sortert på time */
	hourly: Array<{ hour: number; seconds: number; productiveSeconds: number }>;
	/** Aktivitet fra kl. 17 og ut dagen */
	evening: {
		seconds: number;
		productiveSeconds: number;
		byCategory: CategorySeconds[];
	};
}

export const EVENING_START_HOUR = 17;
const TOP_ACTIVITIES_LIMIT = 15;

function sortedCategories(map: Map<string, number>): CategorySeconds[] {
	return [...map.entries()]
		.map(([category, seconds]) => ({ category, seconds }))
		.sort((a, b) => b.seconds - a.seconds);
}

/** Grupperer time-rader til én struktur per kalenderdag. RescueTime rapporterer i kontoens lokale tid. */
export function parseRescueTimeRows(rows: RescueTimeApiRow[]): RescueTimeDayData[] {
	const days = new Map<
		string,
		{
			total: number;
			productive: number;
			distracting: number;
			categories: Map<string, number>;
			activities: Map<string, { category: string; seconds: number }>;
			hours: Map<number, { seconds: number; productiveSeconds: number }>;
			eveningSeconds: number;
			eveningProductive: number;
			eveningCategories: Map<string, number>;
		}
	>();

	for (const row of rows) {
		const [date, secondsRaw, , activity, category, productivity] = row;
		const seconds = Number(secondsRaw);
		if (!date || !Number.isFinite(seconds) || seconds <= 0) continue;

		const dateISO = date.slice(0, 10);
		const hour = Number(date.slice(11, 13));
		if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !Number.isFinite(hour)) continue;

		const day = days.get(dateISO) ?? {
			total: 0,
			productive: 0,
			distracting: 0,
			categories: new Map(),
			activities: new Map(),
			hours: new Map(),
			eveningSeconds: 0,
			eveningProductive: 0,
			eveningCategories: new Map()
		};
		days.set(dateISO, day);

		const isProductive = productivity > 0;
		day.total += seconds;
		if (isProductive) day.productive += seconds;
		if (productivity < 0) day.distracting += seconds;

		day.categories.set(category, (day.categories.get(category) ?? 0) + seconds);

		const act = day.activities.get(activity) ?? { category, seconds: 0 };
		act.seconds += seconds;
		day.activities.set(activity, act);

		const hourEntry = day.hours.get(hour) ?? { seconds: 0, productiveSeconds: 0 };
		hourEntry.seconds += seconds;
		if (isProductive) hourEntry.productiveSeconds += seconds;
		day.hours.set(hour, hourEntry);

		if (hour >= EVENING_START_HOUR) {
			day.eveningSeconds += seconds;
			if (isProductive) day.eveningProductive += seconds;
			day.eveningCategories.set(category, (day.eveningCategories.get(category) ?? 0) + seconds);
		}
	}

	return [...days.entries()]
		.map(([dateISO, day]) => ({
			dateISO,
			totalSeconds: day.total,
			productiveSeconds: day.productive,
			distractingSeconds: day.distracting,
			byCategory: sortedCategories(day.categories),
			topActivities: [...day.activities.entries()]
				.map(([activity, { category, seconds }]) => ({ activity, category, seconds }))
				.sort((a, b) => b.seconds - a.seconds)
				.slice(0, TOP_ACTIVITIES_LIMIT),
			hourly: [...day.hours.entries()]
				.map(([hour, { seconds, productiveSeconds }]) => ({ hour, seconds, productiveSeconds }))
				.sort((a, b) => a.hour - b.hour),
			evening: {
				seconds: day.eveningSeconds,
				productiveSeconds: day.eveningProductive,
				byCategory: sortedCategories(day.eveningCategories)
			}
		}))
		.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}
