import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { buildFerieContextBlock, type FerieContextTheme } from '$lib/ferie/active-ferie';

/**
 * Reise-/ferie-kontekst for chatten: pågående ferie + dens reiser (pågående og kommende)
 * med deltakere, sted og datoer. Leser `ferieProfile` fra brukerens temaer og delegerer
 * formateringen til den rene `buildFerieContextBlock`. Tom streng hvis ingen ferie er aktiv.
 */
export async function buildTripContext(userId: string, todayIso: string): Promise<string> {
	const rows = await db
		.select({ name: themes.name, ferieProfile: themes.ferieProfile })
		.from(themes)
		.where(eq(themes.userId, userId));

	return buildFerieContextBlock(rows as FerieContextTheme[], todayIso);
}
