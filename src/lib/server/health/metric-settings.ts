import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { findHealthThemeId } from '$lib/server/themes';

/**
 * Helse-mortemaets `metric_settings`.
 *
 * Tersklene bor på mortemaet — undertemaene har sin egen (tomme) kolonne som
 * bevisst ikke brukes, slik at «målvekt» betyr det samme på Vekt, Trening og
 * Ernæring. Se CLAUDE.md.
 */
export async function readHealthMetricSettings(userId: string): Promise<Record<string, unknown>> {
	const healthThemeId = await findHealthThemeId(userId);
	if (!healthThemeId) return {};
	const parent = await db.query.themes.findFirst({
		where: eq(themes.id, healthThemeId),
		columns: { metricSettings: true }
	});
	return (parent?.metricSettings ?? {}) as Record<string, unknown>;
}

/** Et tallfelt under en metrikknøkkel, f.eks. `weight.goal`. Null når det ikke er satt. */
export function readMetricNumber(
	settings: Record<string, unknown>,
	key: string,
	field: 'goal' | 'thresholdWarn' | 'thresholdSuccess'
): number | null {
	const entry = settings[key];
	if (!entry || typeof entry !== 'object') return null;
	const value = (entry as Record<string, unknown>)[field];
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
