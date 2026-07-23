/**
 * proactive-research-service — forhåndshenter research for kommende reiser.
 *
 * For reise-temaer med en destinasjon og et startdato i nær framtid, som ennå
 * ikke har lagrede funn, kjøres et dypt reise-søk automatisk og lagres i
 * Research-seksjonen. Da er «ting å gjøre i <sted>» klart før brukeren spør.
 *
 * Kjøres av /api/cron/theme-research (daglig).
 */

import { db } from '$lib/db';
import { themes, themeResearch } from '$lib/db/schema';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { runWebResearch } from '$lib/server/web/web-research';
import { getThemeResearchDomains } from './theme-research-service';
import { resolveResearchScope } from '$lib/server/web/research-domains';

/** Antall dager fram i tid vi forhåndshenter for. */
const LOOKAHEAD_DAYS = 45;
/** Maks temaer å behandle per kjøring (kostnadstak). */
const MAX_PER_RUN = 8;

interface UpcomingTrip {
	themeId: string;
	userId: string;
	destination: string;
	country?: string;
}

/** ISO-dato (YYYY-MM-DD) i dag og om N dager. Ren nok for cron (server-tid). */
export function dateWindow(now: Date, lookaheadDays: number): { today: string; horizon: string } {
	const iso = (d: Date) => d.toISOString().slice(0, 10);
	const horizon = new Date(now.getTime() + lookaheadDays * 86400000);
	return { today: iso(now), horizon: iso(horizon) };
}

/** Er en reise innenfor [today, horizon] og fortsatt aktuell? Ren funksjon. */
export function isTripUpcoming(
	trip: { startDate?: string; endDate?: string },
	today: string,
	horizon: string
): boolean {
	const start = trip.startDate;
	const end = trip.endDate ?? trip.startDate;
	if (!start) return false;
	// Aktuell hvis reisen ikke er over ennå (end >= today) og starter innen horisonten.
	if (end && end < today) return false;
	return start <= horizon;
}

export async function runProactiveThemeResearch(now: Date = new Date()): Promise<{
	success: true;
	scanned: number;
	researched: number;
	skipped: number;
}> {
	const { today, horizon } = dateWindow(now, LOOKAHEAD_DAYS);

	// Hent alle temaer med en reiseprofil.
	const tripThemes = await db
		.select({
			id: themes.id,
			userId: themes.userId,
			name: themes.name,
			tripProfile: themes.tripProfile
		})
		.from(themes)
		.where(isNotNull(themes.tripProfile));

	const upcoming: UpcomingTrip[] = [];
	for (const t of tripThemes) {
		const tp = t.tripProfile;
		if (!tp?.destination) continue;
		if (!isTripUpcoming({ startDate: tp.startDate, endDate: tp.endDate }, today, horizon)) continue;
		upcoming.push({
			themeId: t.id,
			userId: t.userId,
			destination: tp.destination,
			country: tp.country
		});
	}

	let researched = 0;
	let skipped = 0;

	for (const trip of upcoming.slice(0, MAX_PER_RUN)) {
		// Hopp over hvis temaet allerede har lagrede funn.
		const existing = await db
			.select({ n: sql<number>`count(*)` })
			.from(themeResearch)
			.where(and(eq(themeResearch.themeId, trip.themeId), eq(themeResearch.userId, trip.userId)));
		if ((existing[0]?.n ?? 0) > 0) {
			skipped++;
			continue;
		}

		const place = trip.country ? `${trip.destination}, ${trip.country}` : trip.destination;
		const query = `Hva kan jeg gjøre i ${place}? Severdigheter, aktiviteter og spisesteder.`;

		try {
			const themeDomains = await getThemeResearchDomains(trip.themeId, trip.userId).catch(() => null);
			const scope = resolveResearchScope(query, themeDomains);
			const { findings, sources } = await runWebResearch(query, {
				includeDomains: scope.includeDomains,
				excludeDomains: scope.excludeDomains,
				topic: scope.tavilyTopic,
				days: scope.days,
				deep: true,
				deepTopic: scope.topic
			});

			if (sources.length === 0) {
				skipped++;
				continue;
			}

			await db.insert(themeResearch).values({
				themeId: trip.themeId,
				userId: trip.userId,
				query,
				summary: findings,
				sources
			});
			researched++;
		} catch (err) {
			console.warn(`[proactive-research] feilet for tema ${trip.themeId}:`, err);
			skipped++;
		}
	}

	return { success: true, scanned: upcoming.length, researched, skipped };
}
