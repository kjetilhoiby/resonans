import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { findThemeByName } from '$lib/server/themes';
import { HEALTH_PARENT_THEME_NAME } from '$lib/domain/health-subthemes';
import { loadNutritionTargets } from '$lib/server/nutrition/targets';

/**
 * Dagsmål og makrobalanse.
 *
 * Ligger i `metricSettings.nutrition` på Helse-mortemaet, som resten av tersklene.
 * `PUT /api/tema/[id]/metric-settings` bevarer nøkler den ikke eier, så arket og
 * dette endepunktet skriver ikke over hverandre.
 *
 * Andelene trenger ikke summere til 100 — de er mål, ikke en fordeling. Men
 * summerer de til noe langt over, sier vi det, siden det da er umulig å treffe alle.
 */
const FIELDS = ['kcalTarget', 'proteinTarget', 'proteinPct', 'carbsPct', 'fatPct'] as const;

const LIMITS: Record<(typeof FIELDS)[number], [number, number]> = {
	kcalTarget: [800, 6000],
	proteinTarget: [30, 400],
	proteinPct: [5, 60],
	carbsPct: [5, 80],
	fatPct: [5, 70]
};

export const GET: RequestHandler = async ({ locals }) => {
	return json(await loadNutritionTargets(locals.userId));
};

export const PUT: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return json({ error: 'Forventet et JSON-objekt.' }, { status: 400 });
	}

	const parent = await findThemeByName(locals.userId, HEALTH_PARENT_THEME_NAME);
	if (!parent) {
		return json({ error: 'Fant ingen Helse-tema å lagre målene på.' }, { status: 400 });
	}

	const current = (parent.metricSettings ?? {}) as Record<string, unknown>;
	const nutrition = { ...((current.nutrition ?? {}) as Record<string, unknown>) };

	for (const field of FIELDS) {
		if (!(field in body)) continue;
		const value = body[field];
		if (value === null) {
			delete nutrition[field];
			continue;
		}
		const [min, max] = LIMITS[field];
		if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
			return json({ error: `${field} må være et tall mellom ${min} og ${max}.` }, { status: 400 });
		}
		nutrition[field] = value;
	}

	await db
		.update(themes)
		.set({ metricSettings: { ...current, nutrition }, updatedAt: new Date() })
		.where(eq(themes.id, parent.id));

	const saved = await loadNutritionTargets(locals.userId);
	const pctSum = (saved.proteinPct ?? 0) + (saved.carbsPct ?? 0) + (saved.fatPct ?? 0);
	return json({
		...saved,
		// Ikke en feil, men verdt å si: alle tre kan ikke nås om summen er langt fra 100.
		warning:
			pctSum > 0 && (pctSum < 90 || pctSum > 110)
				? `Andelene summerer til ${Math.round(pctSum)} %. De trenger ikke treffe 100 presis, men langt unna gjør målene umulige å nå samtidig.`
				: null
	});
};
