import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { analyzeMealImageTool } from '$lib/ai/tools/analyze-meal-image';

/**
 * POST /api/food/analyze-image
 * Body: { imageUrl: string, servings?: number }
 * Sends a Cloudinary URL to GPT-4o vision and returns dish/ingredient/nutrition estimate.
 * Mirrors the pattern in /api/books/analyze-image but expects the image already to be uploaded
 * via /api/upload-image (or the chat attachment pipeline).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => null);
	if (!body || typeof body.imageUrl !== 'string') {
		return json({ error: 'imageUrl required' }, { status: 400 });
	}

	const result = await analyzeMealImageTool.execute({
		imageUrl: body.imageUrl,
		servings: typeof body.servings === 'number' ? body.servings : undefined
	});

	if ('error' in result) {
		return json(result, { status: 422 });
	}

	return json(result);
};
