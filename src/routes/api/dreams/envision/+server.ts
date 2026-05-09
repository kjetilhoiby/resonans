import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { DreamService } from '$lib/server/services/dream-service';

const HORIZONS = ['vision_5year', 'vision_yearly', 'vision_quarterly', 'vision_themed'] as const;
type Horizon = (typeof HORIZONS)[number];

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json()) as { horizon?: string; themeId?: string };
	const horizon = body.horizon as Horizon | undefined;

	if (!horizon || !HORIZONS.includes(horizon)) {
		return json({ error: 'Invalid horizon' }, { status: 400 });
	}
	if (horizon === 'vision_themed' && !body.themeId) {
		return json({ error: 'themeId required for vision_themed' }, { status: 400 });
	}

	const created = await DreamService.envision(userId, { horizon, themeId: body.themeId });
	return json({ ok: true, dream: created });
};
