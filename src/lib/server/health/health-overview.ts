import { db } from '$lib/db';
import { themeSignalLinks } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getChildThemes } from '$lib/server/themes';
import { getLatestSignalsByType, type LatestSignal } from '$lib/server/services/signal-reader';
import { HEALTH_PARENT_THEME_NAME } from '$lib/domain/health-subthemes';
import {
	presentSignal,
	rankSignalsForOverview,
	type PresentedSignal
} from '$lib/domain/health/signal-presentation';
import {
	buildSubthemeTiles,
	type SubthemeTile
} from '$lib/domain/health/subtheme-tiles';

interface AggregateMetrics {
	weight?: { avg?: number; change?: number };
	sleep?: { avg?: number };
	weeklyEffort?: { total?: number; baseline?: { p4wAvg?: number; delta?: number } };
	screenTime?: { avgPerDayMinutes?: number };
	nutrition?: { kcalPerDay?: number; proteinPerDay?: number; loggedDays?: number };
	sleepDisturbances?: { nights?: number; awakeMinutes?: number | null };
}

interface AggregateRow {
	periodKey: string;
	metrics: unknown;
}

/**
 * Oversiktsdelen av helse-mortemaet: én status-flis per undertema og de
 * kryss-domene signalene som faktisk har noe å si.
 *
 * Signalene rir med i dashboard-payloaden framfor å hentes separat, slik at de
 * caches sammen med resten og komponentene kan demoes på /design uten å fetche
 * selv (se docs/DESIGN.md).
 */
export async function loadHealthOverview(
	userId: string,
	weekly: AggregateRow[],
	monthly: AggregateRow[]
) {
	const [children, latestSignals, links] = await Promise.all([
		getChildThemes(userId, HEALTH_PARENT_THEME_NAME),
		getLatestSignalsByType(userId, { ownerDomain: 'health' }),
		db.query.themeSignalLinks.findMany({
			where: and(eq(themeSignalLinks.userId, userId), eq(themeSignalLinks.enabled, true))
		})
	]);

	const themeIdsByName: Record<string, string> = {};
	for (const child of children) themeIdsByName[child.name] = child.id;

	const tiles = buildSubthemeTiles({
		themeIdsByName,
		...readTileMetrics(weekly, monthly),
		// Egenfrekvens har ingen aggregatmetrikk — nivået kommer fra signalet.
		egenfrekvens: readEgenfrekvensTile(latestSignals)
	});

	return {
		subthemes: tiles satisfies SubthemeTile[],
		signals: selectSignals(latestSignals, links.map((l) => l.signalType))
	};
}

/** Siste uke/måned → tallene undertema-stripen viser. */
function readTileMetrics(weekly: AggregateRow[], monthly: AggregateRow[]) {
	// weekly/monthly kommer eldste-først fra health-dashboard, så siste rad er nyest.
	const latestWeek = (weekly.at(-1)?.metrics ?? null) as AggregateMetrics | null;
	const latestMonth = (monthly.at(-1)?.metrics ?? null) as AggregateMetrics | null;

	return {
		weeklyEffort: latestWeek?.weeklyEffort ?? null,
		// Nivået fra siste uke, endringen fra siste måned: ukesnittet er ferskere,
		// og en 30-dagersendring hentet fra en ukesrad er ikke 30 dager.
		weightKg: latestWeek?.weight?.avg ?? latestMonth?.weight?.avg ?? null,
		weightChange30d: latestMonth?.weight?.change ?? null,
		sleepAvgHours: latestWeek?.sleep?.avg ?? null,
		sleepDisturbedNights: latestWeek?.sleepDisturbances?.nights ?? null,
		screenTimeAvgPerDayMinutes: latestWeek?.screenTime?.avgPerDayMinutes ?? null,
		nutrition: latestWeek?.nutrition ?? null
	};
}

/**
 * Hvilke signaler som vises. Brukeren kan skru signaler av og på per tema via
 * theme_signal_links, men de aller fleste har ikke lenket noe ennå — da faller
 * vi tilbake på alle helse-signaler i stedet for å vise en tom seksjon.
 */
function selectSignals(
	latestSignals: Map<string, LatestSignal>,
	enabledTypes: string[]
): PresentedSignal[] {
	const enabled = new Set(enabledTypes);
	const useLinks = enabledTypes.some((type) => latestSignals.has(type));

	const presented: PresentedSignal[] = [];
	for (const [signalType, latest] of latestSignals) {
		if (useLinks && !enabled.has(signalType)) continue;
		const view = presentSignal(signalType, latest);
		if (view) presented.push(view);
	}

	return rankSignalsForOverview(presented);
}

/** Egenfrekvens-flisen mates av signalet, ikke av aggregatene. */
function readEgenfrekvensTile(latestSignals: Map<string, LatestSignal>) {
	const signal = latestSignals.get('egenfrekvens_trend_7d');
	if (!signal) return null;
	const direction = signal.context.direction;
	return {
		recentAvg: signal.valueNumber,
		direction: typeof direction === 'string' ? direction : null
	};
}
