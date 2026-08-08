/**
 * Payload til Skriving-temaets dashboard.
 *
 * Flata er bevisst tynn: den viser hvor man står og sender deg videre til
 * `/skriv` og `/notater`, som eier redigeringen. Å duplisere prosjektrommet inn
 * i et tema-dashboard ville gitt to steder å vedlikeholde samme liste.
 *
 * Arbeidsdelingen er den samme mortemaene har mot undertemaene: dashboardet
 * viser sammenhengen, flatene eier detaljene.
 */

import { db } from '$lib/db';
import { writingDocs, writingProjects } from '$lib/db/schema';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { countWords, resolveDocKind } from '$lib/domain/writing/doc-kinds';
import { writingStreakDays } from '$lib/domain/writing/exercise';
import { listWritingDayKeys } from '$lib/server/writing/docs';
import { osloDayKey } from '$lib/server/trip-geo';

const STREAK_WINDOW_DAYS = 400;

export interface WritingDashboardProject {
	id: string;
	title: string;
	genre: string | null;
	status: string;
	parts: number;
	words: number;
	characters: number;
	updatedAt: string;
}

export interface WritingDashboardPayload {
	streakDays: number;
	wroteToday: boolean;
	/** Frie dokumenter i notatblokka — ikke knyttet til et prosjekt. */
	looseNotes: number;
	totalWords: number;
	projects: WritingDashboardProject[];
}

export async function buildWritingDashboard(
	userId: string,
	now: Date = new Date()
): Promise<WritingDashboardPayload> {
	const today = osloDayKey(now);

	const [projects, dayKeys, allDocs, loose] = await Promise.all([
		db.query.writingProjects.findMany({
			where: eq(writingProjects.userId, userId),
			orderBy: [desc(writingProjects.updatedAt)]
		}),
		listWritingDayKeys(userId, new Date(now.getTime() - STREAK_WINDOW_DAYS * 24 * 60 * 60 * 1000)),
		db.query.writingDocs.findMany({
			where: eq(writingDocs.userId, userId),
			columns: { projectId: true, kind: true, body: true }
		}),
		db.query.writingDocs.findMany({
			where: and(eq(writingDocs.userId, userId), isNull(writingDocs.projectId)),
			columns: { id: true }
		})
	]);

	const byProject = new Map<string, typeof allDocs>();
	for (const doc of allDocs) {
		if (!doc.projectId) continue;
		const list = byProject.get(doc.projectId) ?? [];
		list.push(doc);
		byProject.set(doc.projectId, list);
	}

	return {
		streakDays: writingStreakDays(dayKeys, today),
		wroteToday: dayKeys.includes(today),
		looseNotes: loose.length,
		// Hele forfatterskapet, ikke bare manusene: et dikt er også skrevet.
		totalWords: allDocs.reduce((sum, d) => sum + countWords(d.body), 0),
		projects: projects.map((p) => {
			const docs = byProject.get(p.id) ?? [];
			const manuscript = docs.filter((d) => resolveDocKind(d.kind).ordered);
			return {
				id: p.id,
				title: p.title,
				genre: p.genre,
				status: p.status,
				parts: manuscript.length,
				words: manuscript.reduce((sum, d) => sum + countWords(d.body), 0),
				characters: docs.filter((d) => d.kind === 'karakter').length,
				updatedAt: p.updatedAt.toISOString()
			};
		})
	};
}
