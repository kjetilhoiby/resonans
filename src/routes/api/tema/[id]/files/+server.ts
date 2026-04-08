import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themeFiles, themes } from '$lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '$env/dynamic/private';
import { extractFileContent } from '$lib/server/file-extraction';
import { createMemory, deleteMemoryBySource, THEME_FILE_MEMORY_SOURCE_PREFIX } from '$lib/server/memories';

// @ts-ignore
const BufferGlobal = Buffer;

cloudinary.config({
	cloud_name: env.CLOUDINARY_CLOUD_NAME,
	api_key: env.CLOUDINARY_API_KEY,
	api_secret: env.CLOUDINARY_API_SECRET
});

// GET — list files for theme
export const GET: RequestHandler = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const files = await db
		.select()
		.from(themeFiles)
		.where(and(eq(themeFiles.themeId, params.id), eq(themeFiles.userId, locals.userId)))
		.orderBy(asc(themeFiles.createdAt));

	return json(files);
};

// POST — upload file for theme
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	if (!env.CLOUDINARY_CLOUD_NAME) {
		return json({ error: 'File storage not configured' }, { status: 500 });
	}

	const formData = await request.formData();
	const file = formData.get('file') as File | null;
	if (!file) return json({ error: 'No file provided' }, { status: 400 });

	// 20 MB limit
	if (file.size > 20 * 1024 * 1024) {
		return json({ error: 'File too large (max 20 MB)' }, { status: 413 });
	}

	const arrayBuffer = await file.arrayBuffer();
	const buffer = BufferGlobal.from(arrayBuffer);
	const base64 = buffer.toString('base64');
	const dataURI = `data:${file.type};base64,${base64}`;

	const isPdf = file.type === 'application/pdf';
	const result = await cloudinary.uploader.upload(dataURI, {
		folder: `resonans/themes/${params.id}`,
		resource_type: isPdf ? 'raw' : 'auto',
		...(!isPdf && {
			transformation: [
				{ width: 2048, height: 2048, crop: 'limit' },
				{ quality: 'auto:good' },
				{ fetch_format: 'auto' }
			]
		})
	});

	const fileType = file.type.startsWith('image/') ? 'image' : isPdf ? 'pdf' : 'document';

	const [saved] = await db
		.insert(themeFiles)
		.values({
			themeId: params.id,
			userId: locals.userId,
			name: file.name,
			url: result.secure_url,
			fileType,
			mimeType: file.type,
			sizeBytes: file.size
		})
		.returning();

	// Parse content and store as memory (fire-and-forget — does not block response)
	void extractFileContent(buffer, file.type, file.name, result.secure_url)
		.then(async ({ text, kind }) => {
			if (!text.trim() || kind === 'unsupported') return;
			const label = kind === 'image_vision' ? '🖼 Bilde' : kind === 'audio_transcript' ? '🎤 Lydopptak' : kind === 'pdf_text' ? '📍 PDF' : '📄 Fil';
			await createMemory({
				userId: locals.userId,
				themeId: params.id,
				category: 'other',
				importance: 'high',
				source: `${THEME_FILE_MEMORY_SOURCE_PREFIX}${saved.id}`,
				content: `${label}: ${file.name}\n${text}`
			});
		})
		.catch((err) => console.error('[upload] Parsing feilet for', file.name, err));

	return json(saved);
};
