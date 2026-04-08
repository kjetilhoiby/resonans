import { pgClient } from '$lib/db';

let ensureConversationThemeIdColumnPromise: Promise<void> | null = null;

export function ensureConversationThemeIdColumn() {
	if (!ensureConversationThemeIdColumnPromise) {
		ensureConversationThemeIdColumnPromise = (async () => {
			const [columnCheck] = await pgClient.unsafe<[{ exists: boolean }]>(`
				SELECT EXISTS (
					SELECT 1
					FROM information_schema.columns
					WHERE table_schema = 'public'
						AND table_name = 'conversations'
						AND column_name = 'theme_id'
				) AS exists
			`);

			if (!columnCheck?.exists) {
				await pgClient.unsafe(`
					ALTER TABLE "conversations"
					ADD COLUMN IF NOT EXISTS "theme_id" uuid REFERENCES "themes"("id") ON DELETE SET NULL
				`);
			}
		})();
	}

	return ensureConversationThemeIdColumnPromise;
}