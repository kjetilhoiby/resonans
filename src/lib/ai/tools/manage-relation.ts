import { z } from 'zod';
import { PersonService } from '$lib/server/services/person-service';
import {
	isValidRelationType,
	type RelationType,
	type RelationSubType
} from '$lib/domains/family';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const manageRelationTool = {
	name: 'manage_relation',
	description: `Create or delete a relation between two persons.
fromPersonId: UUID of the source person, or omit/null when the relation is from the user themselves.
toPersonId: UUID of the target person — must be a UUID from manage_person or query_family, never a name.
relationType: 'family' | 'friend' | 'work'.
subType: 'parent_of' | 'child_of' | 'married_to' | 'partnered_with' | 'sibling_of' | 'in_law_of' | 'friend_of' | 'colleague_of'.`,
	parameters: z.object({
		userId: z.string(),
		action: z.enum(['create', 'delete']),
		relationId: z.string().optional(),
		fromPersonId: z.string().nullable().optional(),
		toPersonId: z.string().optional(),
		relationType: z.string().optional(),
		subType: z.string().optional(),
		closeness: z.number().min(1).max(5).optional(),
		notes: z.string().optional()
	}),
	execute: async (args: {
		userId: string;
		action: 'create' | 'delete';
		relationId?: string;
		fromPersonId?: string | null;
		toPersonId?: string;
		relationType?: string;
		subType?: string;
		closeness?: number;
		notes?: string;
	}) => {
		if (args.action === 'delete') {
			if (!args.relationId) return { error: 'relationId is required' };
			const removed = await PersonService.deleteRelation(args.relationId, args.userId);
			return { relation: removed };
		}
		if (!args.toPersonId) return { error: 'toPersonId is required' };
		if (!UUID_RE.test(args.toPersonId)) {
			return { error: `toPersonId must be a UUID, got "${args.toPersonId}". Use query_family or manage_person to get the person's UUID first.` };
		}
		if (!args.relationType || !isValidRelationType(args.relationType)) {
			return { error: 'relationType must be family|friend|work' };
		}
		const fromPersonId =
			args.fromPersonId && UUID_RE.test(args.fromPersonId) ? args.fromPersonId : null;
		const created = await PersonService.createRelation({
			userId: args.userId,
			fromPersonId,
			toPersonId: args.toPersonId,
			relationType: args.relationType as RelationType,
			subType: (args.subType as RelationSubType | null | undefined) ?? null,
			closeness: args.closeness ?? null,
			notes: args.notes ?? null
		});
		return { relation: created };
	}
};
