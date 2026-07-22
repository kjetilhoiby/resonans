/**
 * theme-research-service — lagring og henting av websøk-runder («research»)
 * knyttet til et tema. Fôres fra chatten (web_search med saveToTheme) og vises
 * som Research-seksjon i Filer på temasiden.
 */

import { db } from '$lib/db';
import { themeResearch, themes } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { WebResearchSource } from '$lib/server/web/web-research';
import { normalizeDomains, type ThemeResearchDomains } from '$lib/server/web/research-domains';

export interface ThemeResearchRow {
	id: string;
	themeId: string;
	query: string;
	summary: string;
	sources: WebResearchSource[];
	createdAt: string;
}

function toRow(r: {
	id: string;
	themeId: string;
	query: string;
	summary: string;
	sources: WebResearchSource[] | null;
	createdAt: Date;
}): ThemeResearchRow {
	return {
		id: r.id,
		themeId: r.themeId,
		query: r.query,
		summary: r.summary,
		sources: r.sources ?? [],
		createdAt: r.createdAt.toISOString()
	};
}

/** Verifiser at temaet finnes og eies av brukeren. Returnerer temanavn eller null. */
async function assertThemeOwner(themeId: string, userId: string): Promise<string | null> {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, themeId), eq(themes.userId, userId)),
		columns: { name: true }
	});
	return theme?.name ?? null;
}

export async function listThemeResearch(themeId: string, userId: string): Promise<ThemeResearchRow[]> {
	const rows = await db
		.select()
		.from(themeResearch)
		.where(and(eq(themeResearch.themeId, themeId), eq(themeResearch.userId, userId)))
		.orderBy(desc(themeResearch.createdAt));
	return rows.map(toRow);
}

export interface SaveThemeResearchArgs {
	themeId: string;
	userId: string;
	query: string;
	summary: string;
	sources: WebResearchSource[];
}

/**
 * Lagre en research-runde på et tema. Returnerer den lagrede raden + temanavn,
 * eller null hvis temaet ikke finnes / ikke eies av brukeren.
 */
export async function saveThemeResearch(
	args: SaveThemeResearchArgs
): Promise<{ row: ThemeResearchRow; themeName: string } | null> {
	const themeName = await assertThemeOwner(args.themeId, args.userId);
	if (themeName === null) return null;

	const [inserted] = await db
		.insert(themeResearch)
		.values({
			themeId: args.themeId,
			userId: args.userId,
			query: args.query,
			summary: args.summary,
			sources: args.sources
		})
		.returning();

	return { row: toRow(inserted), themeName };
}

/** Slett en research-rad. Returnerer true hvis noe ble slettet. */
export async function deleteThemeResearch(
	researchId: string,
	userId: string
): Promise<boolean> {
	const deleted = await db
		.delete(themeResearch)
		.where(and(eq(themeResearch.id, researchId), eq(themeResearch.userId, userId)))
		.returning({ id: themeResearch.id });
	return deleted.length > 0;
}

/** Hent temaets foretrukne/ekskluderte kilder (null hvis temaet ikke eies). */
export async function getThemeResearchDomains(
	themeId: string,
	userId: string
): Promise<ThemeResearchDomains | null> {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, themeId), eq(themes.userId, userId)),
		columns: { researchDomains: true }
	});
	if (!theme) return null;
	return theme.researchDomains ?? { include: [], exclude: [] };
}

/**
 * Sett temaets foretrukne/ekskluderte kilder (domenene normaliseres).
 * Returnerer det lagrede settet, eller null hvis temaet ikke eies av brukeren.
 */
export async function setThemeResearchDomains(
	themeId: string,
	userId: string,
	domains: ThemeResearchDomains
): Promise<ThemeResearchDomains | null> {
	const cleaned: ThemeResearchDomains = {
		include: normalizeDomains(domains.include),
		exclude: normalizeDomains(domains.exclude)
	};

	const updated = await db
		.update(themes)
		.set({ researchDomains: cleaned })
		.where(and(eq(themes.id, themeId), eq(themes.userId, userId)))
		.returning({ id: themes.id });

	if (updated.length === 0) return null;
	return cleaned;
}
