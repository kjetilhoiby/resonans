import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { normalizeAttachmentSource, uploadAndExtractAttachment } from '$lib/server/attachment-extract';

/**
 * Slankt vedleggs-endepunkt: laster opp + trekker ut innhold, uten kald
 * LLM-triage og uten sideeffekter. Brukes når vedlegget havner i en etablert
 * samtale, der selve chatturen håndterer konteksten (innhold injiseres i
 * meldingen, og chatten har verktøy/flyter til å foreslå neste steg).
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
		return json({ error: 'Cloudinary not configured' }, { status: 500 });
	}

	try {
		const formData = await request.formData();
		const file = formData.get('file');
		const noteValue = formData.get('note');
		const sourceValue = formData.get('source');

		if (!(file instanceof File)) {
			return json({ error: 'No file provided' }, { status: 400 });
		}

		const note = typeof noteValue === 'string' ? noteValue.trim() : '';
		const source = normalizeAttachmentSource(sourceValue);

		const { attachment } = await uploadAndExtractAttachment(file, note, source);

		return json({ success: true, attachment });
	} catch (error) {
		console.error('Attachment extract failed:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Attachment extract failed' },
			{ status: 500 }
		);
	}
};
