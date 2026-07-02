import { db } from '$lib/db';
import { themes, persons } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import {
	buildFerieContextBlock,
	makeParticipantResolver,
	type FerieContextTheme
} from '$lib/ferie/active-ferie';

/**
 * Reise-/ferie-kontekst for chatten: pågående ferie + dens reiser (pågående og kommende)
 * med deltakere, sted og datoer. Leser `ferieProfile` fra brukerens temaer og delegerer
 * formateringen til den rene `buildFerieContextBlock`. Deltaker-navn kobles til registrerte
 * personer (delt identitet med person-konteksten; ukjente navn flagges). Tom streng hvis
 * ingen ferie er aktiv.
 */
export async function buildTripContext(userId: string, todayIso: string): Promise<string> {
	const [themeRows, personRows] = await Promise.all([
		db
			.select({ name: themes.name, ferieProfile: themes.ferieProfile })
			.from(themes)
			.where(eq(themes.userId, userId)),
		db
			.select({ name: persons.name, nickname: persons.nickname, aliases: persons.aliases })
			.from(persons)
			.where(and(eq(persons.userId, userId), eq(persons.archived, false)))
	]);

	const resolve = makeParticipantResolver(personRows);
	return buildFerieContextBlock(themeRows as FerieContextTheme[], todayIso, resolve);
}
