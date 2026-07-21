import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import {
	extractFromCloudinaryVideo,
	normalizeAttachmentSource,
	parseCloudinaryVideoForm,
	parseVideoFramesForm,
	uploadAndExtractAttachment,
	uploadAndExtractVideoFrames
} from '$lib/server/attachment-extract';

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

		// Video-remote: klienten lastet videoen rett til Cloudinary (stor fil).
		const remoteInput = parseCloudinaryVideoForm(formData);
		if (remoteInput) {
			const { attachment } = await extractFromCloudinaryVideo(remoteInput);
			return json({ success: true, attachment });
		}

		// Video-som-frames: klienten har trukket ut keyframes on-device.
		const framesInput = await parseVideoFramesForm(formData);
		if (framesInput) {
			const { attachment } = await uploadAndExtractVideoFrames(
				framesInput.frames,
				framesInput.note,
				framesInput.source,
				framesInput.name
			);
			return json({ success: true, attachment });
		}

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
