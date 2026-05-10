import { z } from 'zod';
import { db } from '$lib/db';
import { checklists, checklistItems } from '$lib/db/schema';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const manageHomeRoutineTool = {
	name: 'manage_home_routine',
	description: `Create a home routine — a checklist with context='home_routine' (e.g. weekly cleaning, laundry rotation, seasonal maintenance).
Optionally link items to a project so they count toward burn-up.

For ad-hoc routines that aren't project-bound, leave projectId empty.`,
	parameters: z.object({
		userId: z.string(),
		title: z.string(),
		emoji: z.string().optional(),
		items: z.array(z.string()).describe('Checklist item texts in order'),
		projectId: z.string().optional().describe('If set, all items inherit this projectId for burn-up')
	}),
	execute: async (args: {
		userId: string;
		title: string;
		emoji?: string;
		items: string[];
		projectId?: string;
	}) => {
		if (!args.title) return { error: 'title is required' };
		if (args.items.length === 0) return { error: 'items must not be empty' };
		if (args.projectId && !UUID_RE.test(args.projectId)) {
			return { error: `projectId must be a UUID, got "${args.projectId}"` };
		}

		const [list] = await db
			.insert(checklists)
			.values({
				userId: args.userId,
				title: args.title,
				emoji: args.emoji ?? '🏠',
				context: 'home_routine'
			})
			.returning();

		await db.insert(checklistItems).values(
			args.items.map((text, idx) => ({
				checklistId: list.id,
				userId: args.userId,
				projectId: args.projectId ?? null,
				text,
				sortOrder: idx
			}))
		);

		return { checklist: list, count: args.items.length };
	}
};
