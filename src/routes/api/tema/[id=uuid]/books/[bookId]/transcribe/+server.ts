import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { books, bookClips } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { transcribeAudioWithWords } from '$lib/server/file-extraction';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '$env/dynamic/private';

cloudinary.config({
	cloud_name: env.CLOUDINARY_CLOUD_NAME,
	api_key: env.CLOUDINARY_API_KEY,
	api_secret: env.CLOUDINARY_API_SECRET
});

// @ts-ignore
const BufferGlobal = Buffer;

/**
 * POST — upload an audio/video file, transcribe via Whisper, store as a book clip.
 * Accepts multipart/form-data with:
 *   - file: the audio/video file
 *   - position: optional book position string (e.g. "1:24:35" or "Side 42")
 *   - note: optional user note
 *   - characters: optional comma-separated character/person names
 *
 * Returns: { clip, transcript, audioUrl }
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const book = await db.query.books.findFirst({
		where: and(eq(books.id, params.bookId), eq(books.userId, locals.userId)),
		columns: { id: true, title: true }
	});
	if (!book) return json({ error: 'Not found' }, { status: 404 });

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return json({ error: 'Invalid form data' }, { status: 400 });
	}

	const file = formData.get('file') as File | null;
	if (!file || !file.size) return json({ error: 'No file provided' }, { status: 400 });

	const mimeType = file.type || 'audio/mpeg';
	const isAudioOrVideo = mimeType.startsWith('audio/') || mimeType.startsWith('video/');
	if (!isAudioOrVideo) return json({ error: 'Only audio/video files are supported' }, { status: 400 });

	// File size limit: 25MB (Whisper API limit)
	if (file.size > 25 * 1024 * 1024) {
		return json({ error: 'Filen er for stor (maks 25 MB for transkripsjon)' }, { status: 413 });
	}

	const arrayBuffer = await file.arrayBuffer();
	const buffer = BufferGlobal.from(arrayBuffer);

	// Upload to Cloudinary for storage
	let audioUrl: string | null = null;
	try {
		const base64 = buffer.toString('base64');
		const dataURI = `data:${mimeType};base64,${base64}`;
		const result = await cloudinary.uploader.upload(dataURI, {
			folder: 'resonans/book-clips',
			resource_type: 'video' // Cloudinary uses 'video' for audio too
		});
		audioUrl = result.secure_url;
	} catch (err) {
		console.error('[transcribe] Cloudinary upload failed:', err);
		// Continue without storage URL — transcription still works
	}

	// Transcribe via Whisper with word-level timestamps
	const extraction = await transcribeAudioWithWords(buffer, file.name, mimeType);
	const transcript = extraction.text.trim();
	const words = extraction.words.length > 0 ? extraction.words : null;

	if (!transcript) {
		return json({ error: 'Transkripsjon feilet eller tom' }, { status: 422 });
	}

	const position = typeof formData.get('position') === 'string'
		? (formData.get('position') as string).trim() || null
		: null;
	const note = typeof formData.get('note') === 'string'
		? (formData.get('note') as string).trim() || null
		: null;
	const charactersRaw = typeof formData.get('characters') === 'string'
		? (formData.get('characters') as string).trim()
		: '';
	const characters = charactersRaw
		? charactersRaw.split(',').map((c) => c.trim()).filter(Boolean)
		: null;

	// Save as clip
	const [clip] = await db
		.insert(bookClips)
		.values({
			bookId: params.bookId,
			userId: locals.userId,
			text: transcript,
			position: position || null,
			note: note || null,
			source: 'audio_clip',
			audioUrl: audioUrl || null,
			words: words ?? undefined,
			characters: characters ?? undefined
		})
		.returning();

	return json({ clip, transcript, audioUrl });
};
