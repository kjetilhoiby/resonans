import { z } from 'zod';
import { db } from '$lib/db';
import { projects } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROJECT_STATUSES = ['planning', 'active', 'paused', 'done', 'cancelled'] as const;

export const manageProjectTool = {
	name: 'manage_project',
	description: `Create, update, or close a project. Projects are domain-agnostic primitives (home, trip, event, course, ...).
For home projects, set domain='home' and type to one of 'renovation' | 'maintenance' | 'repair' | 'organize'.
Put domain-specific extras (e.g. {"room":"bathroom","contractor":"..."}) in metadata.
Use 'complete' to mark a project as done (sets status='done' and completedAt=now).
Use 'cancel' to abandon a project.`,
	parameters: z.object({
		userId: z.string(),
		action: z.enum(['create', 'update', 'complete', 'cancel']),
		projectId: z.string().optional(),
		domain: z.string().optional().describe("'home' | 'health' | 'economics' | 'food' | 'family' | 'egenfrekvens' | null"),
		themeId: z.string().optional(),
		title: z.string().optional(),
		description: z.string().optional(),
		type: z.string().optional(),
		status: z.enum(PROJECT_STATUSES).optional(),
		budgetNok: z.number().optional(),
		startedAt: z.string().optional().describe('ISO date'),
		targetCompletionAt: z.string().optional().describe('ISO date'),
		metadata: z.record(z.string(), z.unknown()).optional()
	}),
	execute: async (args: {
		userId: string;
		action: 'create' | 'update' | 'complete' | 'cancel';
		projectId?: string;
		domain?: string;
		themeId?: string;
		title?: string;
		description?: string;
		type?: string;
		status?: (typeof PROJECT_STATUSES)[number];
		budgetNok?: number;
		startedAt?: string;
		targetCompletionAt?: string;
		metadata?: Record<string, unknown>;
	}) => {
		switch (args.action) {
			case 'create': {
				if (!args.title) return { error: 'title is required' };
				const [created] = await db
					.insert(projects)
					.values({
						userId: args.userId,
						domain: args.domain ?? null,
						themeId: args.themeId ?? null,
						title: args.title,
						description: args.description ?? null,
						type: args.type ?? null,
						status: args.status ?? 'planning',
						budgetNok: args.budgetNok ?? null,
						startedAt: args.startedAt ? new Date(args.startedAt) : null,
						targetCompletionAt: args.targetCompletionAt ? new Date(args.targetCompletionAt) : null,
						metadata: args.metadata ?? {}
					})
					.returning();
				return { project: created, created: true };
			}
			case 'update': {
				if (!args.projectId) return { error: 'projectId is required' };
				if (!UUID_RE.test(args.projectId)) {
					return { error: `projectId must be a UUID, got "${args.projectId}". Use query_projects to look it up.` };
				}
				const updates: Record<string, unknown> = { updatedAt: new Date() };
				if (args.domain !== undefined) updates.domain = args.domain || null;
				if (args.themeId !== undefined) updates.themeId = args.themeId || null;
				if (args.title !== undefined) updates.title = args.title;
				if (args.description !== undefined) updates.description = args.description;
				if (args.type !== undefined) updates.type = args.type;
				if (args.status !== undefined) updates.status = args.status;
				if (args.budgetNok !== undefined) updates.budgetNok = args.budgetNok;
				if (args.startedAt !== undefined) updates.startedAt = args.startedAt ? new Date(args.startedAt) : null;
				if (args.targetCompletionAt !== undefined) {
					updates.targetCompletionAt = args.targetCompletionAt ? new Date(args.targetCompletionAt) : null;
				}
				if (args.metadata !== undefined) updates.metadata = args.metadata;

				const [updated] = await db
					.update(projects)
					.set(updates)
					.where(and(eq(projects.id, args.projectId), eq(projects.userId, args.userId)))
					.returning();
				if (!updated) return { error: 'Project not found' };
				return { project: updated };
			}
			case 'complete': {
				if (!args.projectId) return { error: 'projectId is required' };
				const [updated] = await db
					.update(projects)
					.set({ status: 'done', completedAt: new Date(), updatedAt: new Date() })
					.where(and(eq(projects.id, args.projectId), eq(projects.userId, args.userId)))
					.returning();
				if (!updated) return { error: 'Project not found' };
				return { project: updated, completed: true };
			}
			case 'cancel': {
				if (!args.projectId) return { error: 'projectId is required' };
				const [updated] = await db
					.update(projects)
					.set({ status: 'cancelled', updatedAt: new Date() })
					.where(and(eq(projects.id, args.projectId), eq(projects.userId, args.userId)))
					.returning();
				if (!updated) return { error: 'Project not found' };
				return { project: updated, cancelled: true };
			}
		}
	}
};
