import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getThemeInstruction, saveThemeInstruction } from '$lib/server/theme-instructions';

export const GET: RequestHandler = async ({ params, locals }) => {
	const content = await getThemeInstruction(locals.userId, params.id);
	return json({ content });
};

export const PUT: RequestHandler = async ({ request, params, locals }) => {
	const body = await request.json().catch(() => null);
	const content = typeof body?.content === 'string' ? body.content : '';

	if (content.length > 12000) {
		return json({ error: 'Instruction text too long (max 12000 chars).' }, { status: 400 });
	}

	await saveThemeInstruction(locals.userId, params.id, content);
	return json({ success: true });
};
