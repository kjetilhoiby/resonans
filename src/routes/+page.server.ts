import { db } from '$lib/db';
import { themes, trainingPrograms, trainingPlans, programReadinessAssessments, trackReadinessAssessments, trackSessions, reflections } from '$lib/db/schema';
import { eq, and, asc, desc, inArray, sql } from 'drizzle-orm';
import { getUserConversationList } from '$lib/server/conversations';
import { activeFerieThemes } from '$lib/ferie/active-ferie';
import type { PageServerLoad } from './$types';

/**
 * Aktive temaer med kind-klassifisering for tema-sidene på hjemskjermen:
 * ferie-/reiseprofil → 'ferie', prosjektprofil → 'prosjekt', ellers 'standard'.
 * Defensiv mot databaser der profil-kolonnene ikke er migrert ennå.
 */
async function loadActiveThemes(userId: string) {
	const baseColumns = {
		id: themes.id,
		name: themes.name,
		emoji: themes.emoji,
		sortOrder: themes.sortOrder
	};
	const whereActive = and(eq(themes.userId, userId), eq(themes.archived, false));
	try {
		return await db
			.select({
				...baseColumns,
				kind: sql<'standard' | 'ferie' | 'prosjekt'>`case
					when ${themes.ferieProfile} is not null or ${themes.tripProfile} is not null then 'ferie'
					when ${themes.projectProfile} is not null then 'prosjekt'
					else 'standard'
				end`
			})
			.from(themes)
			.where(whereActive)
			.orderBy(asc(themes.sortOrder), asc(themes.createdAt));
	} catch (error) {
		const cause = (error as { cause?: unknown })?.cause;
		const causeMessage = cause instanceof Error ? cause.message : String(cause ?? '');
		if (!/(ferie_profile|trip_profile|project_profile)/i.test(causeMessage)) throw error;
		const rows = await db
			.select(baseColumns)
			.from(themes)
			.where(whereActive)
			.orderBy(asc(themes.sortOrder), asc(themes.createdAt));
		return rows.map((row) => ({ ...row, kind: 'standard' as const }));
	}
}

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

	const [activeThemes, conversationList, activeProgram, activePlanRows, ferieThemes] = await Promise.all([
		loadActiveThemes(locals.userId),
		getUserConversationList(locals.userId, { limit: 6 }),
		db
			.select({ id: trainingPrograms.id, name: trainingPrograms.name })
			.from(trainingPrograms)
			.where(and(eq(trainingPrograms.userId, locals.userId), eq(trainingPrograms.status, 'active')))
			.orderBy(desc(trainingPrograms.createdAt))
			.limit(1),
		db
			.select({ id: trainingPlans.id, name: trainingPlans.name })
			.from(trainingPlans)
			.where(and(eq(trainingPlans.userId, locals.userId), eq(trainingPlans.status, 'active')))
			.orderBy(desc(trainingPlans.createdAt))
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
	// Treningsløp (ny modell) har forrang over legacy-programmer
	if (activePlanRows[0]) {
		try {
			const cached = await db
				.select({
					state: trackReadinessAssessments.state,
					alternative: trackReadinessAssessments.alternative
				})
				.from(trackReadinessAssessments)
				.where(
					and(
						eq(trackReadinessAssessments.userId, locals.userId),
						eq(trackReadinessAssessments.planId, activePlanRows[0].id),
						eq(trackReadinessAssessments.assessmentDate, today)
					)
				)
				.limit(1);
			if (cached[0]) {
				const alt = cached[0].alternative as { name?: string } | null;
				programReadiness = {
					programId: activePlanRows[0].id,
					programName: activePlanRows[0].name,
					state: cached[0].state as 'klar' | 'lett' | 'easy' | 'rest',
					alternativeName: alt?.name ?? null
				};
			}

			// Har jeg allerede trent i dag? Da er «Klar for Treningsløp» misvisende —
			// fjern chippen (den peker på en økt som er gjort). Registrert trening
			// materialiseres som en completed track_session (reconcile/complete-session).
			const doneToday = await db
				.select({ id: trackSessions.id })
				.from(trackSessions)
				.where(
					and(
						eq(trackSessions.userId, locals.userId),
						eq(trackSessions.planId, activePlanRows[0].id),
						eq(trackSessions.date, today),
						eq(trackSessions.status, 'completed')
					)
				)
				.limit(1);
			if (doneToday[0]) programReadiness = null;
		} catch (err) {
			console.error('[home] plan readiness lookup failed:', err);
		}
	} else if (activeProgram[0]) {
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
