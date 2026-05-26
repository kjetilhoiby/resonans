import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getRoutineDefinition,
	upsertRoutineDefinition,
	deleteRoutineDefinition,
	type RoutineDefinitionInput,
	type RoutineSlot
} from '$lib/server/services/routine-service';

const ALLOWED_SLOTS: RoutineSlot[] = ['morning', 'afternoon', 'evening', 'flex'];

function parseInput(id: string, body: unknown): RoutineDefinitionInput {
	if (!body || typeof body !== 'object') throw error(400, 'invalid body');
	const b = body as Record<string, unknown>;

	const title = typeof b.title === 'string' ? b.title.trim() : '';
	if (!title) throw error(400, 'title is required');

	const slot = typeof b.slot === 'string' ? (b.slot as RoutineSlot) : 'flex';
	if (!ALLOWED_SLOTS.includes(slot)) throw error(400, `slot must be one of ${ALLOWED_SLOTS.join(', ')}`);

	const daysOfWeek = Array.isArray(b.daysOfWeek)
		? b.daysOfWeek.map((d) => Number(d)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
		: [];

	const rawItems = Array.isArray(b.items) ? b.items : [];
	const items = rawItems
		.map((it) => {
			if (typeof it === 'string') return { text: it.trim() };
			if (it && typeof it === 'object') {
				const obj = it as Record<string, unknown>;
				const text = typeof obj.text === 'string' ? obj.text.trim() : '';
				if (!text) return null;
				return {
					text,
					estimateMinutes: typeof obj.estimateMinutes === 'number' ? obj.estimateMinutes : undefined,
					sortOrder: typeof obj.sortOrder === 'number' ? obj.sortOrder : undefined
				};
			}
			return null;
		})
		.filter((it): it is { text: string; estimateMinutes?: number; sortOrder?: number } => it !== null && it.text.length > 0);

	return {
		id,
		title,
		emoji: typeof b.emoji === 'string' ? b.emoji : undefined,
		slot,
		daysOfWeek,
		items,
		active: typeof b.active === 'boolean' ? b.active : undefined,
		sortOrder: typeof b.sortOrder === 'number' ? b.sortOrder : undefined
	};
}

export const GET: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	const row = await getRoutineDefinition(userId, params.id);
	if (!row) throw error(404, 'routine not found');
	return json(row);
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	const body = await request.json();
	const input = parseInput(params.id, body);
	const updated = await upsertRoutineDefinition(userId, input);
	return json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params, url }) => {
	const userId = locals.userId;
	const hard = url.searchParams.get('hard') === 'true';
	await deleteRoutineDefinition(userId, params.id, { hard });
	return json({ ok: true });
};
