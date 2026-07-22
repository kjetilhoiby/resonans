/**
 * finds-service.ts — henter funn (lagrede lenker) for et tema.
 *
 * Funn er merket med et domene (food/home/…). Tema-sider har ikke et
 * domene-felt, så domenet utledes fra tema-navnet: først via dashboard-typen
 * (det temaet visuelt ER), ellers via nøkkelord-matching. Reise/bøker/film/
 * kjøretøy har ingen funn-motpart og gir null → ingen funn-seksjon.
 */

import { db } from '$lib/db';
import { finds, themes } from '$lib/db/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { resolveDomainFromInput } from '$lib/domains';
import type { FindDomain } from '$lib/server/email-processors/find-triage';

export type FindRow = typeof finds.$inferSelect;

// DashboardKind → FindDomain. Kinds uten funn-motpart (travel/ferie/books/
// film/vehicle) mangler bevisst her → faller tilbake til nøkkelord-matching.
const KIND_TO_DOMAIN: Record<string, FindDomain> = {
	health: 'health',
	economics: 'economics',
	food: 'food',
	family: 'family',
	home: 'home',
	egenfrekvens: 'self'
};

/** Utled domenet et tema tilhører (eller null om det ikke mapper til noe). */
export function resolveThemeDomain(themeName: string | null | undefined): FindDomain | null {
	const kind = resolveThemeDashboardKind(themeName);
	const mapped = kind ? KIND_TO_DOMAIN[kind] : undefined;
	if (mapped) return mapped;
	// DomainType ⊆ FindDomain — nøkkelord-fallback fanger bl.a. jobb/self.
	return resolveDomainFromInput(themeName ?? '');
}

/** Funn for et tema (via navn) — status inbox + kept, nyeste først. */
export async function getThemeFindsByName(userId: string, themeName: string | null | undefined): Promise<FindRow[]> {
	const domain = resolveThemeDomain(themeName);
	if (!domain) return [];
	return db.query.finds.findMany({
		where: and(
			eq(finds.userId, userId),
			eq(finds.domain, domain),
			inArray(finds.status, ['inbox', 'kept'])
		),
		orderBy: [desc(finds.createdAt)],
		limit: 50
	});
}

/** Funn for et tema (via themeId) — slår opp tema-navnet først. */
export async function getFindsForTheme(userId: string, themeId?: string | null): Promise<FindRow[]> {
	if (!themeId) return [];
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, themeId), eq(themes.userId, userId)),
		columns: { name: true }
	});
	if (!theme) return [];
	return getThemeFindsByName(userId, theme.name);
}

/** Formater funn som en kompakt kontekst-blokk for chat-system-prompten. */
export function buildFindsContextBlock(rows: FindRow[]): string {
	if (rows.length === 0) return '';
	let out = '\n--- FUNN I TEMAET (lagrede lenker) ---\n';
	for (const f of rows) {
		const meta = [f.kind ? `[${f.kind}]` : '', f.summary ?? ''].filter(Boolean).join(' ');
		out += `- ${f.title}${meta ? ` — ${meta}` : ''}${f.sourceUrl ? ` (${f.sourceUrl})` : ''}\n`;
	}
	out += '--- SLUTT PÅ FUNN ---\n';
	return out;
}
