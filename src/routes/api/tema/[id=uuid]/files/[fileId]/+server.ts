import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themeFiles } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

// DELETE /api/tema/[id]/files/[fileId]
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const file = await db.query.themeFiles.findFirst({
		where: and(eq(themeFiles.id, params.fileId), eq(themeFiles.userId, locals.userId)),
		columns: { id: true }
	});
	if (!file) return json({ error: 'Not found' }, { status: 404 });

	await db.delete(themeFiles).where(eq(themeFiles.id, params.fileId));

	return json({ success: true });
};
