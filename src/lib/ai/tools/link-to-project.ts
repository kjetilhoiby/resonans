import { z } from 'zod';
import { db } from '$lib/db';
import { tasks, checklistItems, categorizedEvents, projects } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const linkToProjectTool = {
	name: 'link_to_project',
	description: `Attach or detach existing tasks, checklist-items, or categorized transactions to/from a project.
Linked items contribute to the project's burn-up (tasks/items) or cost-vs-budget (transactions).

Use action='attach' with projectId to link. Use action='detach' (no projectId needed) to clear the link.

Always confirm with the user before linking transactions — categorization can be ambiguous.`,
	parameters: z.object({
		userId: z.string(),
		action: z.enum(['attach', 'detach']),
		entity: z.enum(['task', 'checklist_item', 'transaction']),
		entityIds: z.array(z.string()).describe('IDs of the entities to link/unlink'),
		projectId: z.string().optional().describe('Required for attach; ignored for detach')
	}),
	execute: async (args: {
		userId: string;
		action: 'attach' | 'detach';
		entity: 'task' | 'checklist_item' | 'transaction';
		entityIds: string[];
		projectId?: string;
	}) => {
		if (args.entityIds.length === 0) return { error: 'entityIds must not be empty' };
		for (const id of args.entityIds) {
			if (!UUID_RE.test(id)) return { error: `entityId must be a UUID, got "${id}"` };
		}

		let targetProjectId: string | null = null;
		if (args.action === 'attach') {
			if (!args.projectId) return { error: 'projectId is required for attach' };
			if (!UUID_RE.test(args.projectId)) return { error: `projectId must be a UUID, got "${args.projectId}"` };
			const project = await db.query.projects.findFirst({
				where: and(eq(projects.id, args.projectId), eq(projects.userId, args.userId)),
				columns: { id: true }
			});
			if (!project) return { error: 'Project not found' };
			targetProjectId = project.id;
		}

		switch (args.entity) {
			case 'task': {
				// Tasks are scoped via goal/personId; we apply by id and trust that the chat
				// already knows which tasks belong to the user. Defense: look up first.
				const owned = await db
					.select({ id: tasks.id })
					.from(tasks)
					.where(inArray(tasks.id, args.entityIds));
				const ownedIds = owned.map((r) => r.id);
				if (ownedIds.length === 0) return { error: 'No matching tasks found' };
				await db.update(tasks).set({ projectId: targetProjectId, updatedAt: new Date() }).where(inArray(tasks.id, ownedIds));
				return { linked: ownedIds.length, ids: ownedIds, projectId: targetProjectId };
			}
			case 'checklist_item': {
				const owned = await db
					.select({ id: checklistItems.id })
					.from(checklistItems)
					.where(and(inArray(checklistItems.id, args.entityIds), eq(checklistItems.userId, args.userId)));
				const ownedIds = owned.map((r) => r.id);
				if (ownedIds.length === 0) return { error: 'No matching checklist items found' };
				await db.update(checklistItems).set({ projectId: targetProjectId }).where(inArray(checklistItems.id, ownedIds));
				return { linked: ownedIds.length, ids: ownedIds, projectId: targetProjectId };
			}
			case 'transaction': {
				const owned = await db
					.select({ id: categorizedEvents.id })
					.from(categorizedEvents)
					.where(and(inArray(categorizedEvents.id, args.entityIds), eq(categorizedEvents.userId, args.userId)));
				const ownedIds = owned.map((r) => r.id);
				if (ownedIds.length === 0) return { error: 'No matching transactions found' };
				await db
					.update(categorizedEvents)
					.set({ projectId: targetProjectId, updatedAt: new Date() })
					.where(inArray(categorizedEvents.id, ownedIds));
				return { linked: ownedIds.length, ids: ownedIds, projectId: targetProjectId };
			}
		}
	}
};
