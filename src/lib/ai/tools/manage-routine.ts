import { z } from 'zod';
import {
	listRoutineDefinitions,
	getRoutineDefinition,
	upsertRoutineDefinition,
	deleteRoutineDefinition,
	type RoutineSlot
} from '$lib/server/services/routine-service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOTS: RoutineSlot[] = ['morning', 'afternoon', 'evening', 'flex'];

const itemSchema = z.union([
	z.string(),
	z.object({
		text: z.string(),
		estimateMinutes: z.number().optional()
	})
]);

export const manageRoutineTool = {
	name: 'manage_routine',
	description: `Administrer brukerens rutiner — faste, gjentakende grupper av små handlinger knyttet til ukedag og tidspunkt.
Eksempler: "Lørdag morgen" (støvsuge, vaske bad), "Hverdagskveld" (matpakker, rydde kjøkken), "Morgen" (vann, yoga).

action=list: list alle rutiner.
action=create: opprett ny. Krever title, slot, daysOfWeek (0=søndag..6=lørdag), items.
action=update: oppdater eksisterende. Krever id og samme felter som create.
action=delete: deaktiver (soft delete). Krever id.

slot styrer når rutinen vises på hjemskjermen:
- morning: 04:00-12:00
- afternoon: 12:00-17:00
- evening: 17:00-23:59
- flex: hele dagen

daysOfWeek-eksempler:
- [6] = bare lørdag
- [0] = bare søndag
- [1,2,3,4,5] = hverdager
- [0,1,2,3,4,5,6] = hver dag`,
	parameters: z.object({
		userId: z.string(),
		action: z.enum(['list', 'create', 'update', 'delete']),
		id: z.string().optional(),
		title: z.string().optional(),
		emoji: z.string().optional(),
		slot: z.enum(['morning', 'afternoon', 'evening', 'flex']).optional(),
		daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
		items: z.array(itemSchema).optional(),
		active: z.boolean().optional()
	}),
	execute: async (args: {
		userId: string;
		action: 'list' | 'create' | 'update' | 'delete';
		id?: string;
		title?: string;
		emoji?: string;
		slot?: RoutineSlot;
		daysOfWeek?: number[];
		items?: Array<string | { text: string; estimateMinutes?: number }>;
		active?: boolean;
	}) => {
		const { userId, action } = args;

		if (action === 'list') {
			const rows = await listRoutineDefinitions(userId, { includeInactive: false });
			return {
				routines: rows.map((r) => ({
					id: r.id,
					title: r.title,
					emoji: r.emoji,
					slot: r.slot,
					daysOfWeek: r.daysOfWeek,
					itemCount: r.items.length,
					active: r.active
				}))
			};
		}

		if (action === 'delete') {
			if (!args.id || !UUID_RE.test(args.id)) return { error: 'id må være en UUID' };
			await deleteRoutineDefinition(userId, args.id);
			return { ok: true, id: args.id };
		}

		// create / update
		if (!args.title || args.title.trim().length === 0) return { error: 'title er påkrevd' };
		if (!args.slot || !SLOTS.includes(args.slot)) return { error: `slot må være en av ${SLOTS.join(', ')}` };
		if (!args.daysOfWeek || args.daysOfWeek.length === 0) return { error: 'daysOfWeek må inneholde minst én ukedag (0=søndag..6=lørdag)' };
		if (!args.items || args.items.length === 0) return { error: 'items må ikke være tom' };

		if (action === 'update' && (!args.id || !UUID_RE.test(args.id))) {
			return { error: 'id må være en UUID for update' };
		}

		const normalizedItems = args.items.map((it, idx) =>
			typeof it === 'string'
				? { text: it, sortOrder: idx }
				: { text: it.text, estimateMinutes: it.estimateMinutes, sortOrder: idx }
		);

		const saved = await upsertRoutineDefinition(userId, {
			id: action === 'update' ? args.id : undefined,
			title: args.title,
			emoji: args.emoji,
			slot: args.slot,
			daysOfWeek: args.daysOfWeek,
			items: normalizedItems,
			active: args.active
		});

		return {
			routine: {
				id: saved.id,
				title: saved.title,
				emoji: saved.emoji,
				slot: saved.slot,
				daysOfWeek: saved.daysOfWeek,
				itemCount: saved.items.length,
				active: saved.active
			},
			action
		};
	}
};
