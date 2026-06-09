import { db } from '$lib/db';
import { themes, checklists, checklistItems } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';

export const PROJECT_CHECKLIST_CONTEXT_PREFIX = 'theme_project:';

// Verifiserer at temaet finnes og eies av brukeren. Kaster 404 ellers.
export async function requireTheme(userId: string, themeId: string) {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, themeId), eq(themes.userId, userId))
	});
	if (!theme) throw error(404, 'Tema ikke funnet');
	return theme;
}

// Hvert prosjekt-tema har én checklist (context='theme_project:<id>') som oppgavene henger på.
export async function ensureProjectChecklist(userId: string, themeId: string, themeName: string) {
	const context = `${PROJECT_CHECKLIST_CONTEXT_PREFIX}${themeId}`;
	const existing = await db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, context))
	});
	if (existing) return existing.id;

	const [created] = await db
		.insert(checklists)
		.values({ userId, title: themeName, emoji: '🔨', context })
		.returning({ id: checklists.id });
	return created.id;
}

export function mapTaskItem(item: typeof checklistItems.$inferSelect) {
	const meta = (item.metadata ?? {}) as Record<string, unknown>;
	return {
		id: item.id,
		text: item.text,
		checked: item.checked,
		parentId: item.parentId,
		sortOrder: item.sortOrder,
		startDate: item.startDate,
		dueDate: item.dueDate,
		estimateMinutes: item.estimateMinutes,
		blockedBy: (meta.blockedBy as string[] | undefined) ?? [],
		shopping: (meta.shopping as boolean | undefined) ?? false,
		store: (meta.store as string | undefined) ?? null,
		createdAt: (item.createdAt as Date).toISOString()
	};
}
