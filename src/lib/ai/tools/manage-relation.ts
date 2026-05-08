import { z } from 'zod';
import { PersonService } from '$lib/server/services/person-service';
import {
	isValidRelationType,
	type RelationType,
	type RelationSubType
} from '$lib/domains/family';

export const manageRelationTool = {
	name: 'manage_relation',
	description: `Create or delete a relation between two persons (or between self and a person, with fromPersonId=null).
relationType is the broad category: 'family' | 'friend' | 'work'.
subType is more specific: 'parent_of' | 'child_of' | 'married_to' | 'partnered_with' | 'sibling_of' | 'in_law_of' | 'friend_of' | 'colleague_of'.`,
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
		if (!args.relationType || !isValidRelationType(args.relationType)) {
			return { error: 'relationType must be family|friend|work' };
		}
		const created = await PersonService.createRelation({
			userId: args.userId,
			fromPersonId: args.fromPersonId ?? null,
			toPersonId: args.toPersonId,
			relationType: args.relationType as RelationType,
			subType: (args.subType as RelationSubType | null | undefined) ?? null,
			closeness: args.closeness ?? null,
			notes: args.notes ?? null
		});
		return { relation: created };
	}
};
