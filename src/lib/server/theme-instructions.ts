import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

export async function getThemeInstruction(userId: string, themeId: string): Promise<string> {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, themeId), eq(themes.userId, userId)),
		columns: { instructions: true }
	});
	return theme?.instructions ?? '';
}

export async function saveThemeInstruction(userId: string, themeId: string, content: string) {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, themeId), eq(themes.userId, userId)),
		columns: { id: true }
	});

	if (!theme) {
		throw new Error('Theme not found');
	}

	const normalized = content.trim();

	const [updated] = await db
		.update(themes)
		.set({ instructions: normalized.length > 0 ? normalized : null, updatedAt: new Date() })
		.where(eq(themes.id, themeId))
		.returning();
	return updated;
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
