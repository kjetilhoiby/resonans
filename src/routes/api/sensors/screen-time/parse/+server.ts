import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseScreenTimeImage } from '$lib/server/integrations/screen-time-parser';

/**
 * POST /api/sensors/screen-time/parse
 * Body: { imageUrl: string }
 * Tolker et iOS Skjermtid-skjermbilde og returnerer forhåndsvisning (ingen lagring).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const { imageUrl } = await request.json().catch(() => ({}));
	if (typeof imageUrl !== 'string' || imageUrl.length === 0) {
		return json({ error: 'imageUrl kreves' }, { status: 400 });
	}

	const parsed = await parseScreenTimeImage(imageUrl);
	if (parsed.kind === 'unknown') {
		return json({ success: false, kind: 'unknown', message: parsed.reason });
	}
	return json({ success: true, parsed });
};
