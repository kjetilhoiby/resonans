/**
 * Kroppsprofilen, lest fra `themes.metricSettings.profile` på Helse-mortemaet.
 *
 * Høyde, fødselsår og kjønn finnes ikke noe annet sted i basen — Withings gir bare
 * vekt. Uten dem kan vi ikke regne hvileforbrenning selv, og da returneres null
 * framfor et gjettet tall: et forbrukstall bygget på antatt kroppshøyde ser like
 * troverdig ut som et ekte.
 */

import { findThemeByName } from '$lib/server/themes';
import { HEALTH_PARENT_THEME_NAME } from '$lib/domain/health-subthemes';
import type { Sex } from '$lib/domain/health/energy-expenditure';

export interface StoredBodyProfile {
	heightCm: number | null;
	birthYear: number | null;
	sex: Sex | null;
	/** Overstyrer `DESK_JOB_FACTOR` når brukeren vet bedre. */
	deskJobFactor: number | null;
	/** Sant når alt som trengs til Mifflin-St Jeor er satt (utenom vekt). */
	complete: boolean;
}

export async function readBodyProfile(userId: string): Promise<StoredBodyProfile> {
	const parent = await findThemeByName(userId, HEALTH_PARENT_THEME_NAME);
	const settings = (parent?.metricSettings ?? {}) as Record<string, unknown>;
	const profile = (settings.profile ?? {}) as Record<string, unknown>;

	const num = (value: unknown): number | null =>
		typeof value === 'number' && Number.isFinite(value) ? value : null;

	const heightCm = num(profile.heightCm);
	const birthYear = num(profile.birthYear);
	const sex = profile.sex === 'male' || profile.sex === 'female' ? profile.sex : null;

	return {
		heightCm,
		birthYear,
		sex,
		deskJobFactor: num(profile.deskJobFactor),
		complete: heightCm !== null && birthYear !== null && sex !== null
	};
}

/** Alder i hele år fra fødselsår. Null når året mangler. */
export function ageFromBirthYear(birthYear: number | null): number | null {
	if (birthYear === null) return null;
	return new Date().getUTCFullYear() - birthYear;
}
