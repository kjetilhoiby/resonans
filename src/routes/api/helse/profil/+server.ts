import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { findThemeByName } from '$lib/server/themes';
import { HEALTH_PARENT_THEME_NAME } from '$lib/domain/health-subthemes';
import { readBodyProfile } from '$lib/server/health/body-profile';
import {
	isPlausibleBirthYear,
	validateDeskJobFactor,
	validateHeightCm
} from '$lib/domain/health/body-profile-fields';

/**
 * Kroppsprofilen som trengs for å regne hvileforbrenning selv: høyde, fødselsår
 * og kjønn. Vekta kommer fra Withings.
 *
 * Lagres i `themes.metricSettings.profile` på Helse-mortemaet, samme sted som
 * søvnterskler og makspuls. `PUT /api/tema/[id]/metric-settings` bevarer nøkler den
 * ikke eier, så de to skriver ikke over hverandre.
 *
 * NB: ikke under `/api/health/` — det prefikset er public og får aldri
 * `locals.userId` satt.
 */
export const GET: RequestHandler = async ({ locals }) => {
	return json(await readBodyProfile(locals.userId));
};

export const PUT: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return json({ error: 'Forventet et JSON-objekt.' }, { status: 400 });
	}

	const parent = await findThemeByName(locals.userId, HEALTH_PARENT_THEME_NAME);
	if (!parent) {
		return json({ error: 'Fant ingen Helse-tema å lagre profilen på.' }, { status: 400 });
	}

	const current = (parent.metricSettings ?? {}) as Record<string, unknown>;
	const profile = { ...((current.profile ?? {}) as Record<string, unknown>) };

	// Hvert felt er valgfritt, slik at man kan sette ett av gangen. null fjerner.
	// Grensene og meldingene deles med flaten, så en verdi som godtas der ikke
	// avvises her med en annen forklaring.
	if ('heightCm' in body) {
		const value = body.heightCm;
		if (value === null) delete profile.heightCm;
		else {
			const error = validateHeightCm(value);
			if (error) return json({ error }, { status: 400 });
			profile.heightCm = value;
		}
	}

	if ('birthYear' in body) {
		const value = body.birthYear;
		if (value === null) delete profile.birthYear;
		else if (!isPlausibleBirthYear(value)) {
			return json({ error: 'Fødselsåret må være et rimelig årstall.' }, { status: 400 });
		} else profile.birthYear = value;
	}

	if ('sex' in body) {
		const value = body.sex;
		if (value === null) delete profile.sex;
		else if (value !== 'male' && value !== 'female') {
			return json({ error: "sex må være 'male' eller 'female'." }, { status: 400 });
		} else profile.sex = value;
	}

	if ('deskJobFactor' in body) {
		const value = body.deskJobFactor;
		if (value === null) delete profile.deskJobFactor;
		else {
			const error = validateDeskJobFactor(value);
			if (error) return json({ error }, { status: 400 });
			profile.deskJobFactor = value;
		}
	}

	await db
		.update(themes)
		.set({ metricSettings: { ...current, profile }, updatedAt: new Date() })
		.where(eq(themes.id, parent.id));

	return json(await readBodyProfile(locals.userId));
};
