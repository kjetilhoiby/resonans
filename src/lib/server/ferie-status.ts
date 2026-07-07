import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { and, eq, isNotNull } from 'drizzle-orm';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { isFerieActiveOn, type FerieWindow } from '$lib/ferie/active-ferie';

/**
 * Sann hvis brukeren har et aktivt ferie-tema hvis vindu dekker ISO-datoen.
 *
 * Brukes bl.a. av egenfrekvens-sjekkinnen for å behandle feriedager som
 * fridager — da slipper man «Hvordan gikk arbeidsdagen?» midt i ferien og
 * får den roligere helg-rytmen i stedet.
 */
export async function isUserOnFerie(userId: string, iso: string): Promise<boolean> {
	const rows = await db
		.select({ name: themes.name, ferieProfile: themes.ferieProfile })
		.from(themes)
		.where(
			and(eq(themes.userId, userId), eq(themes.archived, false), isNotNull(themes.ferieProfile))
		);
	return rows.some(
		(t) =>
			resolveThemeDashboardKind(t.name) === 'ferie' &&
			isFerieActiveOn(t.ferieProfile as FerieWindow | null, iso)
	);
}
