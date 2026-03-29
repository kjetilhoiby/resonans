import { db } from '$lib/db';
import { memories, themes } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

const THEME_INSTRUCTION_SOURCE = 'theme_instruction';

export async function getThemeInstruction(userId: string, themeId: string): Promise<string> {
	const memory = await db.query.memories.findFirst({
		where: and(
			eq(memories.userId, userId),
			eq(memories.themeId, themeId),
			eq(memories.source, THEME_INSTRUCTION_SOURCE)
		),
		orderBy: [desc(memories.updatedAt)]
	});

	return memory?.content ?? '';
}

export async function saveThemeInstruction(userId: string, themeId: string, content: string) {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, themeId), eq(themes.userId, userId))
	});

	if (!theme) {
		throw new Error('Theme not found');
	}

	const existing = await db.query.memories.findFirst({
		where: and(
			eq(memories.userId, userId),
			eq(memories.themeId, themeId),
			eq(memories.source, THEME_INSTRUCTION_SOURCE)
		),
		orderBy: [desc(memories.updatedAt)]
	});

	const normalized = content.trim();

	if (existing) {
		const [updated] = await db
			.update(memories)
			.set({
				content: normalized,
				importance: normalized ? 'high' : 'medium',
				updatedAt: new Date(),
				lastAccessedAt: new Date()
			})
			.where(eq(memories.id, existing.id))
			.returning();
		return updated;
	}

	const [created] = await db
		.insert(memories)
		.values({
			userId,
			themeId,
			category: 'preferences',
			content: normalized,
			importance: normalized ? 'high' : 'medium',
			source: THEME_INSTRUCTION_SOURCE
		})
		.returning();

	return created;
}

export async function seedThemeInstructionFromFutureVision(userId: string, themeId: string, visionText: string) {
	const existing = await getThemeInstruction(userId, themeId);
	if (existing.trim().length > 0) return;

	const seeded = `# Instrukser\n\n## Langsiktig retning\n${visionText.trim()}`;
	await saveThemeInstruction(userId, themeId, seeded);
}

export function isFutureVisionText(text: string): boolean {
	const normalized = text.toLowerCase();
	return /(fem år|5 år|om fem|om 5|fremtid|langsiktig|visjon)/.test(normalized);
}
