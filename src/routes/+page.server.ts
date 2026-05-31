import { db } from '$lib/db';
import { themes, trainingPrograms, programReadinessAssessments, sensors } from '$lib/db/schema';
import { eq, and, asc, desc } from 'drizzle-orm';
import { getUserConversationList } from '$lib/server/conversations';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const t0 = Date.now();
	console.log('[home] load start, userId:', locals.userId);

	const today = new Date().toISOString().slice(0, 10);

	const [activeThemes, conversationList, activeProgram, screenTimeSensor] = await Promise.all([
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
		db
			.select({ id: sensors.id })
			.from(sensors)
			.where(and(eq(sensors.userId, locals.userId), eq(sensors.provider, 'screen_time')))
			.limit(1)
	]);

	const hasScreenTime = screenTimeSensor.length > 0;

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
	return { themes: activeThemes, recentConversations, programReadiness, hasScreenTime };
};
