import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { filmClips } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

// DELETE — remove a clip
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const clip = await db.query.filmClips.findFirst({
		where: and(eq(filmClips.id, params.clipId), eq(filmClips.userId, locals.userId)),
		columns: { id: true }
	});
	if (!clip) return json({ error: 'Not found' }, { status: 404 });

	await db.delete(filmClips).where(eq(filmClips.id, params.clipId));
	return json({ deleted: true });
};
