/**
 * health-theme.ts — hvor Helse-flaten bor, ett sted.
 *
 * Både sykdoms-pushen og hurtighandlingen på hjemskjermen skal føre til samme
 * kort. To oppslag som begge gjetter på temanavnet ville kunnet peke ulike
 * steder — og en chip som havner et annet sted enn varselet den svarer på, er
 * verre enn ingen chip.
 *
 * Dashboardtypen utledes av temanavnet (`resolveThemeDashboardKind`), ikke av
 * hierarkiet — se «Mortema» i CLAUDE.md.
 */

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';

/**
 * Stien til Helse-mortemaet, relativ.
 *
 * Faller tilbake på `/tema/helse`: sideruta `/tema/[id]` tar bevisst imot navn
 * og ikke bare uuid-er, så fallbacken er en fungerende lenke — ikke en 404.
 */
export async function healthThemePath(userId: string): Promise<string> {
	const rows = await db
		.select({ id: themes.id, name: themes.name })
		.from(themes)
		.where(eq(themes.userId, userId));
	const theme = rows.find((t) => resolveThemeDashboardKind(t.name) === 'health');
	return theme ? `/tema/${theme.id}` : '/tema/helse';
}

export async function healthThemeUrl(userId: string, appUrl: string): Promise<string> {
	return `${appUrl}${await healthThemePath(userId)}`;
}
