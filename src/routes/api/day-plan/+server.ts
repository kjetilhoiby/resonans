import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklists, checklistItems, memories } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json() as {
		dayIso: string;
		weekDashedKey: string;
		headline: string;
		tasks: string[];
	};

	const { dayIso, weekDashedKey, headline, tasks } = body;

	if (!dayIso || !weekDashedKey) {
		return json({ error: 'Missing required fields' }, { status: 400 });
	}

	const compactKey = weekDashedKey.replace('-W', 'W');
	const headlineSource = `week-plan:${compactKey}:day:${dayIso}:headline`;

	// Save headline to memories
	const existingHeadline = await db.query.memories.findFirst({
		where: and(eq(memories.userId, userId), eq(memories.source, headlineSource))
	});

	if (headline?.trim()) {
		if (existingHeadline) {
			await db
				.update(memories)
				.set({ content: headline.trim(), updatedAt: new Date(), lastAccessedAt: new Date() })
				.where(eq(memories.id, existingHeadline.id));
		} else {
			await db.insert(memories).values({
				userId,
				category: 'other',
				content: headline.trim(),
				importance: 'medium',
				source: headlineSource
			});
		}
	} else if (existingHeadline) {
		await db.delete(memories).where(eq(memories.id, existingHeadline.id));
	}

	// Save tasks to day checklist
	if (tasks?.length) {
		const dayContext = `week:${weekDashedKey}:day:${dayIso}`;

		let dayChecklist = await db.query.checklists.findFirst({
			where: and(eq(checklists.userId, userId), eq(checklists.context, dayContext)),
			with: {
				items: {
					orderBy: (items, { asc }) => [asc(items.sortOrder), asc(items.createdAt)]
				}
			}
		});

		if (!dayChecklist) {
			const [newChecklist] = await db
				.insert(checklists)
				.values({ userId, title: `Dag ${dayIso}`, emoji: '☑️', context: dayContext })
				.returning();
			dayChecklist = { ...newChecklist!, items: [] };
		}

		const existingTexts = new Set(
			(dayChecklist.items ?? []).map((i) => i.text.trim().toLowerCase())
		);
		const toAdd = tasks
			.map((t) => t.trim())
			.filter((t) => t.length > 0 && !existingTexts.has(t.toLowerCase()));

		if (toAdd.length > 0) {
			const nextOrder =
				(dayChecklist.items ?? []).reduce((m, i) => Math.max(m, i.sortOrder), -1) + 1;
			await db.insert(checklistItems).values(
				toAdd.map((text, i) => ({
					checklistId: dayChecklist!.id,
					userId,
					text,
					sortOrder: nextOrder + i
				}))
			);
		}
	}

	return json({ success: true });
};
