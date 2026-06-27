import { db } from '$lib/db';
import { themes, trainingPrograms, programReadinessAssessments, reflections } from '$lib/db/schema';
import { eq, and, asc, desc, inArray } from 'drizzle-orm';
import { getUserConversationList } from '$lib/server/conversations';
import { activeFerieThemes } from '$lib/ferie/active-ferie';
import type { PageServerLoad } from './$types';

/**
 * Ferie-temaer med vindu. Defensiv mot databaser der ferie_profile-kolonnen
 * ikke er migrert ennå (samme mønster som ukeplan-lasten).
 */
async function loadFerieThemes(userId: string) {
	try {
		return await db.query.themes.findMany({
			where: and(eq(themes.userId, userId), eq(themes.archived, false)),
			columns: { id: true, name: true, emoji: true, ferieProfile: true }
		});
	} catch (error) {
		const cause = (error as { cause?: unknown })?.cause;
		const causeMessage = cause instanceof Error ? cause.message : String(cause ?? '');
		if (!/ferie_profile/i.test(causeMessage)) throw error;
		return [];
	}
}

export const load: PageServerLoad = async ({ locals }) => {
	const t0 = Date.now();
	console.log('[home] load start, userId:', locals.userId);

	const today = new Date().toISOString().slice(0, 10);

	const [activeThemes, conversationList, activeProgram, ferieThemes] = await Promise.all([
		db
			.select({
				id: themes.id,
				name: themes.name,
				emoji: themes.emoji,
				sortOrder: themes.sortOrder,
			})
			.from(themes)
			.where(and(eq(themes.userId, locals.userId), eq(themes.archived, false)))
			.orderBy(asc(themes.sortOrder), asc(themes.createdAt)),
		getUserConversationList(locals.userId, { limit: 6 }),
		db
			.select({ id: trainingPrograms.id, name: trainingPrograms.name })
			.from(trainingPrograms)
			.where(and(eq(trainingPrograms.userId, locals.userId), eq(trainingPrograms.status, 'active')))
			.orderBy(desc(trainingPrograms.createdAt))
			.limit(1),
		loadFerieThemes(locals.userId)
	]);

	// Pågående ferie nå → ikon ved datoen for rask tilgang.
	const activeFerie = activeFerieThemes(ferieThemes, today, today);

	// «Skriv feriedagbok»-hurtighandling når dagens notat mangler i en pågående ferie.
	let feriedagbokTodo: { themeId: string; themeName: string; emoji: string } | null = null;
	if (activeFerie.length > 0) {
		const ferieIds = activeFerie.map((f) => f.id);
		const todaysEntries = await db
			.select({ themeId: reflections.themeId })
			.from(reflections)
			.where(
				and(
					eq(reflections.userId, locals.userId),
					eq(reflections.kind, 'feriedagbok'),
					eq(reflections.periodKey, today),
					inArray(reflections.themeId, ferieIds)
				)
			);
		const doneThemeIds = new Set(todaysEntries.map((r) => r.themeId));
		const pending = activeFerie.find((f) => !doneThemeIds.has(f.id));
		if (pending) {
			feriedagbokTodo = { themeId: pending.id, themeName: pending.name, emoji: pending.emoji };
		}
	}

	console.log('[home] db done in', Date.now() - t0, 'ms — themes:', activeThemes.length, 'convs:', conversationList.length);

	let programReadiness: {
		programId: string;
		programName: string;
		state: 'klar' | 'lett' | 'easy' | 'rest';
		alternativeName: string | null;
	} | null = null;
	if (activeProgram[0]) {
		try {
			const cached = await db
				.select({
					state: programReadinessAssessments.state,
					alternative: programReadinessAssessments.alternative
				})
				.from(programReadinessAssessments)
				.where(
					and(
						eq(programReadinessAssessments.userId, locals.userId),
						eq(programReadinessAssessments.programId, activeProgram[0].id),
						eq(programReadinessAssessments.assessmentDate, today)
					)
				)
				.limit(1);
			if (cached[0]) {
				const alt = cached[0].alternative as { name?: string } | null;
				programReadiness = {
					programId: activeProgram[0].id,
					programName: activeProgram[0].name,
					state: cached[0].state as 'klar' | 'lett' | 'easy' | 'rest',
					alternativeName: alt?.name ?? null
				};
			}
		} catch (err) {
			console.error('[home] readiness lookup failed:', err);
		}
	}

	const recentConversations = conversationList.map((c) => ({
		id: c.id,
		title: c.title,
		preview: c.preview,
		starred: c.starred,
		archived: c.archived,
		linkedTheme: c.linkedTheme,
		updatedAt: c.updatedAt.toISOString()
	}));

	console.log('[home] load done in', Date.now() - t0, 'ms');
	return { themes: activeThemes, recentConversations, programReadiness, activeFerie, feriedagbokTodo };
};
