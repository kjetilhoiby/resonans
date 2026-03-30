import { pgClient } from '$lib/db';

let ensureConversationThemeIdColumnPromise: Promise<void> | null = null;

export function ensureConversationThemeIdColumn() {
	if (!ensureConversationThemeIdColumnPromise) {
		ensureConversationThemeIdColumnPromise = (async () => {
			await pgClient.unsafe(`
				ALTER TABLE "conversations"
				ADD COLUMN IF NOT EXISTS "theme_id" uuid REFERENCES "themes"("id") ON DELETE SET NULL
			`);
		})();
	}

	return ensureConversationThemeIdColumnPromise;
}