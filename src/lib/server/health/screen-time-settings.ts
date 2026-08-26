/**
 * screen-time-settings.ts
 *
 * Skjermtid-innstillingene (passivfiltrering + apper som ikke teller) bor i
 * Helse-mortemaets `metric_settings.screenTime`, samme sted som terskler og
 * ernæringsmål — se CLAUDE.md.
 *
 * **Én lesevei og én skrivevei.** Flaten, chatten og målene skal se samme
 * innstilling: to lesere som gjetter ulikt gir to ulike skjermtidstall for
 * samme uke, og da er begge ubrukelige.
 *
 * Skriving BEVARER nøkler dette arket ikke eier — samme regel som
 * `PUT /api/tema/[id]/metric-settings`, av samme grunn: en stille sletting av
 * ernæringsmål eller vektterskler er usynlig i basen.
 */

import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { findHealthThemeId } from '$lib/server/themes';
import {
	DEFAULT_ATTENTION_SETTINGS,
	normalizeAttentionSettings,
	type ScreenTimeAttentionSettings
} from '$lib/domain/health/screen-time-attention';

export const SCREEN_TIME_SETTINGS_KEY = 'screenTime';

/** Les innstillingene. Uten helse-tema eller lagret rad: standardverdiene. */
export async function readScreenTimeSettings(userId: string): Promise<ScreenTimeAttentionSettings> {
	const healthThemeId = await findHealthThemeId(userId);
	if (!healthThemeId) return { ...DEFAULT_ATTENTION_SETTINGS };
	const theme = await db.query.themes.findFirst({
		where: eq(themes.id, healthThemeId),
		columns: { metricSettings: true }
	});
	const settings = (theme?.metricSettings ?? {}) as Record<string, unknown>;
	return normalizeAttentionSettings(settings[SCREEN_TIME_SETTINGS_KEY]);
}

/**
 * Skriv innstillingene. Returnerer den normaliserte formen som faktisk ble
 * lagret, slik at klienten kan vise hva som ble godtatt framfor hva den sendte.
 *
 * Returnerer null når brukeren ikke har et Helse-tema — da finnes det ingen
 * plass å lagre på, og en stille suksess ville sett ut som at valget virket.
 */
export async function saveScreenTimeSettings(
	userId: string,
	raw: unknown
): Promise<ScreenTimeAttentionSettings | null> {
	const healthThemeId = await findHealthThemeId(userId);
	if (!healthThemeId) return null;

	const next = normalizeAttentionSettings(raw);
	const existing = await db.query.themes.findFirst({
		where: eq(themes.id, healthThemeId),
		columns: { metricSettings: true }
	});
	const preserved = { ...((existing?.metricSettings ?? {}) as Record<string, unknown>) };
	preserved[SCREEN_TIME_SETTINGS_KEY] = next;

	await db
		.update(themes)
		.set({ metricSettings: preserved, updatedAt: new Date() })
		.where(eq(themes.id, healthThemeId));

	return next;
}
