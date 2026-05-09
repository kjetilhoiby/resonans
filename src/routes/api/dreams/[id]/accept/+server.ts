import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { dreams } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { MemoryService } from '$lib/server/services/memory-service';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const dreamId = params.id;
	const dream = await db.query.dreams.findFirst({
		where: and(eq(dreams.id, dreamId), eq(dreams.userId, userId)),
		columns: { id: true }
	});
	if (!dream) return json({ error: 'Not found' }, { status: 404 });

	const body = (await request.json().catch(() => ({}))) as { acceptIndices?: number[] };

	const candidates = await MemoryService.proposeFromDream(dreamId);
	const indices = body.acceptIndices ?? candidates.map((_, i) => i);

	const accepted = [];
	for (const idx of indices) {
		const candidate = candidates[idx];
		if (!candidate) continue;
		const created = await MemoryService.accept(userId, candidate);
		if (created) accepted.push(created);
	}

	// Marker drømmen som user_confirmed når brukeren har akseptert noe fra den.
	if (accepted.length > 0) {
		await db.update(dreams).set({ confidence: 'user_confirmed' }).where(eq(dreams.id, dreamId));
	}

	return json({ ok: true, accepted });
};
