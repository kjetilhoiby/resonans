import { z } from 'zod';
import { findPoolCandidates, markSurfaced } from '$lib/server/pool/query';

export const suggestTasksForSlotTool = {
	name: 'suggest_tasks_for_slot',
	description: `Foreslå 1-3 pool-tasks som passer en tilgjengelig tidsluke. Bruk når brukeren sier "jeg har 15 min", "har du noe jeg kan gjøre på en halvtime?", eller lignende. Returnerer { suggestions: [{id, title, estimatedMinutes, reason}] } der reason forklarer hvorfor (snart frist / sesong nå / passer tiden).`,
	parameters: z.object({
		userId: z.string(),
		availableMinutes: z.number().int().positive(),
		effort: z.enum(['low', 'medium', 'high']).optional(),
		contextTags: z.array(z.string()).optional(),
		limit: z.number().int().positive().max(10).optional()
	}),
	execute: async (args: {
		userId: string;
		availableMinutes: number;
		effort?: 'low' | 'medium' | 'high';
		contextTags?: string[];
		limit?: number;
	}) => {
		const candidates = await findPoolCandidates({
			userId: args.userId,
			availableMinutes: args.availableMinutes,
			effort: args.effort,
			contextTags: args.contextTags,
			limit: args.limit ?? 3,
			includeStubs: false
		});

		if (candidates.length > 0) {
			await markSurfaced(candidates.map((c) => c.id));
		}

		return {
			suggestions: candidates.map((c) => ({
				id: c.id,
				title: c.title,
				estimatedMinutes: c.estimatedMinutes,
				effort: c.effort,
				dueDate: c.dueDate,
				reason: c.reason ?? null
			}))
		};
	}
};
