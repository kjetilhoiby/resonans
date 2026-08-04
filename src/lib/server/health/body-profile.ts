/**
 * Kroppsprofilen, lest fra `themes.metricSettings.profile` på Helse-mortemaet.
 *
 * Høyde og kjønn finnes ikke noe annet sted i basen — Withings gir bare vekt. Uten
 * dem kan vi ikke regne hvileforbrenning selv, og da returneres null framfor et
 * gjettet tall: et forbrukstall bygget på antatt kroppshøyde ser like troverdig ut
 * som et ekte.
 *
 * ## Fødselsåret har to kilder, og profilen er ikke den første
 *
 * Fødselsdato bor allerede på **self-personen** (`persons.birthDate`), der den driver
 * årskavalkaden og selvangivelse-fristen. Å be brukeren om fødselsåret på nytt for å
 * regne hvileforbrenning ville vært to felt for samme faktum, med to sannheter når
 * bare ett rettes.
 *
 * Derfor: `metricSettings.profile.birthYear` er en **overstyring** og vinner når den
 * finnes, ellers utledes året av self-personens fødselsdato. `birthYearSource` sier
 * hvilken av dem tallet kom fra, slik at flaten kan peke brukeren til rett felt.
 *
 * (Året, ikke datoen: Mifflin-St Jeor flytter seg ~5 kcal på ett års alder, så en
 * bursdag senere i året er under støygulvet.)
 */

import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { persons } from '$lib/db/schema';
import { findThemeByName } from '$lib/server/themes';
import { HEALTH_PARENT_THEME_NAME } from '$lib/domain/health-subthemes';
import { birthYearFromDate, isPlausibleBirthYear } from '$lib/domain/health/body-profile-fields';
import type { Sex } from '$lib/domain/health/energy-expenditure';

// Feltlogikken bor i domenelaget, der den er testet og kan importeres av flaten.
export { ageFromBirthYear } from '$lib/domain/health/body-profile-fields';

export interface StoredBodyProfile {
	heightCm: number | null;
	birthYear: number | null;
	sex: Sex | null;
	/** Overstyrer `DESK_JOB_FACTOR` når brukeren vet bedre. */
	deskJobFactor: number | null;
	/**
	 * Hvor fødselsåret kom fra. `'person'` betyr utledet av fødselsdatoen i profilen,
	 * `'profile'` en eksplisitt overstyring her.
	 */
	birthYearSource: 'profile' | 'person' | null;
	/** Sant når alt som trengs til Mifflin-St Jeor er satt (utenom vekt). */
	complete: boolean;
}

export async function readBodyProfile(userId: string): Promise<StoredBodyProfile> {
	const [parent, self] = await Promise.all([
		findThemeByName(userId, HEALTH_PARENT_THEME_NAME),
		db.query.persons.findFirst({
			columns: { birthDate: true },
			where: and(eq(persons.userId, userId), eq(persons.kind, 'self'), eq(persons.archived, false))
		})
	]);

	const settings = (parent?.metricSettings ?? {}) as Record<string, unknown>;
	const profile = (settings.profile ?? {}) as Record<string, unknown>;

	const num = (value: unknown): number | null =>
		typeof value === 'number' && Number.isFinite(value) ? value : null;

	const heightCm = num(profile.heightCm);
	const sex = profile.sex === 'male' || profile.sex === 'female' ? profile.sex : null;

	const overrideYear = isPlausibleBirthYear(profile.birthYear) ? (profile.birthYear as number) : null;
	const personYear = birthYearFromDate(self?.birthDate ?? null);
	const birthYear = overrideYear ?? personYear;

	return {
		heightCm,
		birthYear,
		sex,
		deskJobFactor: num(profile.deskJobFactor),
		birthYearSource: overrideYear !== null ? 'profile' : personYear !== null ? 'person' : null,
		complete: heightCm !== null && birthYear !== null && sex !== null
	};
}
