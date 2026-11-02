// Matloggen — skillet mellom PLAN og HISTORIKK på meal_plans.
//
// En meal_plans-rad var fram til november 2026 bare en plan: ingenting sa om
// middagen faktisk ble spist. MCP-klienten løste det ved å skrive «Spist» i
// notatfeltet, og alt som leste radene (forslagene i onsdagsøkta, «unngå det vi
// nylig spiste») kunne ikke skille en plan som ble fulgt fra en som ble droppet
// til fordel for takeaway. Se docs/changelog/2026-11-02-middagsplan-og-historikk.md.
//
// Reglene her er rene og testet; lagringen bor i meal-plan-sync.ts.

export const MEAL_PLAN_STATUSES = ['planned', 'eaten', 'skipped'] as const;
export type MealPlanStatus = (typeof MEAL_PLAN_STATUSES)[number];

export function isMealPlanStatus(value: unknown): value is MealPlanStatus {
	return typeof value === 'string' && (MEAL_PLAN_STATUSES as readonly string[]).includes(value);
}

/**
 * Taggen som skiller takeaway og restaurant fra retter man lager selv. Den ligger
 * på RETTEN (meals.tags), ikke på planraden: «Peppes pizza» er takeaway hver
 * gang, og retten skal fortsatt telles i historikken — den skal bare aldri
 * foreslås som noe å lage, og aldri gi en handleliste.
 */
export const TAKEAWAY_TAG = 'takeaway';

/** Taggene som betyr «familiefavoritt». Delt med forslagsmotoren (meal-suggestions.ts). */
export const FAVORITE_TAGS = ['favoritt', 'favorite', 'slager'] as const;

function lowerTags(tags: readonly string[] | null | undefined): string[] {
	return (tags ?? []).map((t) => t.trim().toLowerCase());
}

export function isTakeawayMeal(tags: readonly string[] | null | undefined): boolean {
	return lowerTags(tags).includes(TAKEAWAY_TAG);
}

export function isFavoriteMeal(tags: readonly string[] | null | undefined): boolean {
	const lower = lowerTags(tags);
	return FAVORITE_TAGS.some((t) => lower.includes(t));
}

/**
 * Sett eller fjern én tagg uten å røre de andre. Brukes for `favorite` og
 * `takeaway`, som er tagger av historiske grunner (forslagsmotoren leste
 * favoritt-taggene før noe verktøy kunne sette dem) — en egen kolonne ville
 * gitt to kilder til samme sak.
 */
export function withTag(tags: readonly string[] | null | undefined, tag: string, on: boolean): string[] {
	const target = tag.toLowerCase();
	const aliases = target === 'favoritt' ? FAVORITE_TAGS.map(String) : [target];
	const kept = (tags ?? []).filter((t) => !aliases.includes(t.trim().toLowerCase()));
	return on ? [...kept, tag] : kept;
}

/**
 * Status fra dag-punktet i ukeplanen. Avkrysset «middag: X» ER registreringen av
 * at middagen ble spist — det finnes ingen egen «marker som spist»-knapp, og det
 * skal ikke finnes en: to signaler for samme sak går fra hverandre.
 *
 * Et utsatt punkt (snooze) er ikke droppet; planraden flytter seg med det.
 */
export function statusFromChecklistItem(item: {
	checked: boolean;
	skippedAt: Date | string | null;
	snoozedToDate?: string | null;
}): MealPlanStatus {
	if (item.checked) return 'eaten';
	if (item.skippedAt && !item.snoozedToDate) return 'skipped';
	return 'planned';
}

/** Motsatt vei: hvordan dag-punktet skal stå for en gitt status. */
export function checklistStateForStatus(status: MealPlanStatus): { checked: boolean; skipped: boolean } {
	return { checked: status === 'eaten', skipped: status === 'skipped' };
}

/**
 * En middag kan ikke være spist før dagen har vært. I dag er lov — den
 * registreres gjerne mens oppvasken står.
 */
export function validateStatusForDate(
	status: MealPlanStatus,
	date: string,
	todayIso: string
): string | null {
	if (status === 'eaten' && date > todayIso) {
		return `En middag datert ${date} kan ikke være spist ennå (i dag er ${todayIso}). Bruk status «planned» for framtidige dager.`;
	}
	return null;
}

/**
 * Status slik den skal LESES. En plan på en dag som har vært, og som ingen har
 * bekreftet, er verken spist eller droppet — vi vet ikke. Å lese den som spist
 * ville gjort historikken til en kopi av planen; å lese den som droppet ville
 * straffet familier som aldri huker av.
 */
export type MealLogReading = MealPlanStatus | 'unconfirmed';

export function readMealStatus(status: MealPlanStatus, date: string, todayIso: string): MealLogReading {
	if (status === 'planned' && date < todayIso) return 'unconfirmed';
	return status;
}

export const MEAL_LOG_READING_LABEL: Record<MealLogReading, string> = {
	planned: 'planlagt',
	eaten: 'spist',
	skipped: 'droppet',
	unconfirmed: 'planlagt, ikke bekreftet'
};

export type MealLogEntry = {
	date: string;
	mealType: string;
	mealId: string | null;
	title: string | null;
	status: MealPlanStatus;
	takeaway: boolean;
};

export type MealHistoryStat = {
	mealId: string;
	title: string;
	timesEaten: number;
	lastEaten: string | null;
	timesSkipped: number;
	takeaway: boolean;
};

export type MealHistorySummary = {
	eaten: number;
	skipped: number;
	unconfirmed: number;
	takeaway: number;
	/** Mest spiste først, så sist spist. Bare retter som faktisk er spist. */
	mostEaten: MealHistoryStat[];
	/** Andel av dagene som har vært der vi vet hva som skjedde. */
	confirmedShare: number | null;
	note: string | null;
};

/**
 * Oppsummer historikken. Bare BEKREFTEDE rader teller som spist; ubekreftede
 * telles for seg og sies med ord, så en modell ikke leser «3 spist» som at
 * familien bare spiste middag tre ganger på to uker.
 */
export function summarizeMealHistory(
	entries: readonly MealLogEntry[],
	todayIso: string,
	opts: { top?: number } = {}
): MealHistorySummary {
	const past = entries.filter((e) => e.date <= todayIso);
	let eaten = 0;
	let skipped = 0;
	let unconfirmed = 0;
	let takeaway = 0;
	const byMeal = new Map<string, MealHistoryStat>();

	for (const entry of past) {
		const reading = readMealStatus(entry.status, entry.date, todayIso);
		if (reading === 'eaten') {
			eaten += 1;
			if (entry.takeaway) takeaway += 1;
		} else if (reading === 'skipped') skipped += 1;
		else if (reading === 'unconfirmed') unconfirmed += 1;

		if (!entry.mealId || (reading !== 'eaten' && reading !== 'skipped')) continue;
		const stat = byMeal.get(entry.mealId) ?? {
			mealId: entry.mealId,
			title: entry.title ?? '?',
			timesEaten: 0,
			lastEaten: null,
			timesSkipped: 0,
			takeaway: entry.takeaway
		};
		if (reading === 'eaten') {
			stat.timesEaten += 1;
			if (!stat.lastEaten || entry.date > stat.lastEaten) stat.lastEaten = entry.date;
		} else {
			stat.timesSkipped += 1;
		}
		byMeal.set(entry.mealId, stat);
	}

	const mostEaten = [...byMeal.values()]
		.filter((s) => s.timesEaten > 0)
		.sort((a, b) => b.timesEaten - a.timesEaten || (b.lastEaten ?? '').localeCompare(a.lastEaten ?? ''))
		.slice(0, opts.top ?? 15);

	const decided = eaten + skipped;
	const total = decided + unconfirmed;
	const confirmedShare = total > 0 ? decided / total : null;

	let note: string | null = null;
	if (unconfirmed > 0) {
		note =
			`${unconfirmed} planlagte måltider på dager som har vært er verken bekreftet spist eller droppet. ` +
			'Ikke tell dem som spist — spør heller, og registrer svaret med manage_meal_plan (status).';
	}

	return { eaten, skipped, unconfirmed, takeaway, mostEaten, confirmedShare, note };
}
