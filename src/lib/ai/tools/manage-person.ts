import { z } from 'zod';
import { PersonService } from '$lib/server/services/person-service';
import { isValidPersonKind, type PersonKind } from '$lib/domains/family';

export const managePersonTool = {
	name: 'manage_person',
	description: `Create, update, or archive a person in the user's network.
Use 'suggest_create' first when a new person is mentioned in conversation but not confirmed by the user yet.
Use 'create' only when the user has confirmed the person should be added.
Use 'update' to set fields on an existing person (e.g. add Spond group id, fill in birth date).
Use 'archive' to soft-delete (sets archived=true).`,
	parameters: z.object({
		userId: z.string(),
		action: z.enum(['suggest_create', 'create', 'update', 'archive']),
		personId: z.string().optional(),
		name: z.string().optional(),
		fullName: z.string().optional(),
		nickname: z.string().optional(),
		birthDate: z.string().optional().describe('ISO date YYYY-MM-DD'),
		kind: z.string().optional(),
		avatarEmoji: z.string().optional(),
		notes: z.string().optional(),
		spondGroupIds: z.array(z.string()).optional(),
		emailAddresses: z.array(z.string()).optional(),
		aliases: z.array(z.string()).optional()
	}),
	execute: async (args: {
		userId: string;
		action: 'suggest_create' | 'create' | 'update' | 'archive';
		personId?: string;
		name?: string;
		fullName?: string;
		nickname?: string;
		birthDate?: string;
		kind?: string;
		avatarEmoji?: string;
		notes?: string;
		spondGroupIds?: string[];
		emailAddresses?: string[];
		aliases?: string[];
	}) => {
		const kind: PersonKind | undefined =
			args.kind && isValidPersonKind(args.kind) ? args.kind : undefined;

		switch (args.action) {
			case 'suggest_create': {
				if (!args.name) return { error: 'name is required' };
				return {
					suggestion: {
						name: args.name,
						kind: kind ?? 'other',
						birthDate: args.birthDate ?? null,
						avatarEmoji: args.avatarEmoji ?? null,
						notes: args.notes ?? null
					},
					message: `Foreslår å lagre ${args.name} som ny person. Bekreft for å opprette.`
				};
			}
			case 'create': {
				if (!args.name) return { error: 'name is required' };
				const existing = await PersonService.findByName(args.userId, args.name);
				if (existing) {
					return { person: existing, message: `Personen ${args.name} finnes allerede.` };
				}
				const created = await PersonService.create({
					userId: args.userId,
					name: args.name,
					fullName: args.fullName ?? null,
					nickname: args.nickname ?? null,
					birthDate: args.birthDate ?? null,
					kind: kind ?? 'other',
					avatarEmoji: args.avatarEmoji ?? null,
					notes: args.notes ?? null,
					spondGroupIds: args.spondGroupIds ?? [],
					emailAddresses: args.emailAddresses ?? [],
					aliases: args.aliases ?? []
				});
				return { person: created, created: true };
			}
			case 'update': {
				if (!args.personId) return { error: 'personId is required' };
				const updated = await PersonService.update(args.personId, args.userId, {
					name: args.name,
					fullName: args.fullName,
					nickname: args.nickname,
					birthDate: args.birthDate,
					kind,
					avatarEmoji: args.avatarEmoji,
					notes: args.notes,
					spondGroupIds: args.spondGroupIds,
					emailAddresses: args.emailAddresses,
					aliases: args.aliases
				});
				return { person: updated };
			}
			case 'archive': {
				if (!args.personId) return { error: 'personId is required' };
				const archived = await PersonService.archive(args.personId, args.userId);
				return { person: archived };
			}
		}
	}
};
