import { db } from '$lib/db';
import { taskFiles, tasks, goals } from '$lib/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '$env/dynamic/private';
import { extractFileContent } from './file-extraction';
import { createMemory, deleteMemoryBySource, TASK_FILE_MEMORY_SOURCE_PREFIX } from './memories';

cloudinary.config({
	cloud_name: env.CLOUDINARY_CLOUD_NAME,
	api_key: env.CLOUDINARY_API_KEY,
	api_secret: env.CLOUDINARY_API_SECRET
});

const MAX_FILE_BYTES = 20 * 1024 * 1024;

async function ensureTaskOwnership(taskId: string, userId: string) {
	const row = await db
		.select({ id: tasks.id })
		.from(tasks)
		.innerJoin(goals, eq(goals.id, tasks.goalId))
		.where(and(eq(tasks.id, taskId), eq(goals.userId, userId)))
		.limit(1);
	return !!row[0];
}

export async function listTaskFiles(taskId: string, userId: string) {
	if (!(await ensureTaskOwnership(taskId, userId))) return null;
	return db
		.select()
		.from(taskFiles)
		.where(and(eq(taskFiles.taskId, taskId), eq(taskFiles.userId, userId)))
		.orderBy(asc(taskFiles.createdAt));
}

export interface UploadTaskFileResult {
	status: 'ok' | 'not_found' | 'too_large' | 'storage_unavailable';
	file?: typeof taskFiles.$inferSelect;
}

export async function uploadTaskFile(taskId: string, userId: string, file: File): Promise<UploadTaskFileResult> {
	if (!(await ensureTaskOwnership(taskId, userId))) return { status: 'not_found' };
	if (!env.CLOUDINARY_CLOUD_NAME) return { status: 'storage_unavailable' };
	if (file.size > MAX_FILE_BYTES) return { status: 'too_large' };

	const arrayBuffer = await file.arrayBuffer();
	const buffer = Buffer.from(arrayBuffer);
	const base64 = buffer.toString('base64');
	const dataURI = `data:${file.type};base64,${base64}`;

	const isPdf = file.type === 'application/pdf';
	const result = await cloudinary.uploader.upload(dataURI, {
		folder: `resonans/tasks/${taskId}`,
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
		.insert(taskFiles)
		.values({
			taskId,
			userId,
			name: file.name,
			url: result.secure_url,
			fileType,
			mimeType: file.type,
			sizeBytes: file.size
		})
		.returning();

	void extractFileContent(buffer, file.type, file.name, result.secure_url)
		.then(async ({ text, kind }) => {
			if (!text.trim() || kind === 'unsupported') return;
			const label =
				kind === 'image_vision' ? '🖼 Bilde'
				: kind === 'audio_transcript' ? '🎤 Lydopptak'
				: kind === 'pdf_text' ? '📍 PDF'
				: '📄 Fil';
			await createMemory({
				userId,
				category: 'other',
				importance: 'high',
				source: `${TASK_FILE_MEMORY_SOURCE_PREFIX}${saved.id}`,
				content: `${label}: ${file.name}\n${text}`
			});
		})
		.catch((err) => console.error('[task-files] extraction failed for', file.name, err));

	return { status: 'ok', file: saved };
}

export async function deleteTaskFile(taskId: string, userId: string, fileId: string) {
	if (!(await ensureTaskOwnership(taskId, userId))) return false;
	const [deleted] = await db
		.delete(taskFiles)
		.where(and(eq(taskFiles.id, fileId), eq(taskFiles.taskId, taskId), eq(taskFiles.userId, userId)))
		.returning();
	if (!deleted) return false;
	await deleteMemoryBySource(`${TASK_FILE_MEMORY_SOURCE_PREFIX}${fileId}`);
	return true;
}
