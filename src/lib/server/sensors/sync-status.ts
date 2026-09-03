import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * Lange feilmeldinger (HTML-feilsider, stack traces) kappes. Feltet leses i et
 * Google Chat-varsel og i `/api/health?debug=true` — en melding som ikke kan
 * leses der, er ikke et signal.
 */
const MAX_ERROR_LENGTH = 500;

/**
 * Skriv feilen som stoppet en synk på sensoren, så den overlever en restart.
 *
 * ## Hvorfor dette finnes
 *
 * Fram til september 2026 skrev SpareBank1, Withings og Spond `lastError` BARE
 * som `null`, og bare ved suksess. Feltet var altså skrive-ved-suksess: en synk
 * som hadde stått i tre døgn viste fortsatt `null` fra sist den gikk bra, og
 * monitoreringsvarselet skrev «lastError: null» — som leses som «ingen feil».
 * Det eneste sporet av den ekte feilen lå i `console.error`, altså i en
 * ringbuffer som er per prosess og tømmes ved hver redeploy. Da SpareBank1 sto
 * fra 30. august til 3. september, var beviset borte før noen lette etter det.
 *
 * RescueTime, Dropbox, Tesla og Google Sheets gjorde dette riktig hele tiden.
 * Dette er de tre som manglet.
 *
 * ## Kaster aldri
 *
 * Den kalles fra en catch-blokk. Kastet den selv, ville den erstattet den ekte
 * feilen med sin egen — og en feilsøking som starter med feil melding er verre
 * enn en som starter med ingen.
 *
 * Sensoren slås opp på `isActive`, samme filter som `checkSensorFreshness`
 * bruker: feilen skal lande på nøyaktig den raden varselet leser.
 */
export async function recordSensorSyncFailure(
	userId: string,
	provider: string,
	err: unknown
): Promise<void> {
	const message = err instanceof Error ? err.message : String(err);

	try {
		await db
			.update(sensors)
			.set({ lastError: message.slice(0, MAX_ERROR_LENGTH), updatedAt: new Date() })
			.where(
				and(
					eq(sensors.userId, userId),
					eq(sensors.provider, provider),
					eq(sensors.isActive, true)
				)
			);
	} catch (writeErr) {
		console.error(
			`[sync-status] kunne ikke skrive lastError for ${provider} user=${userId}:`,
			writeErr
		);
	}
}
