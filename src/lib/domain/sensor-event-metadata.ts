/**
 * Metadata-nøkler på `sensor_events` som BRUKEREN eier, ikke synken.
 *
 * En integrasjon som skriver med `upsert_sensor_datatype_timestamp` setter
 * `metadata` i sin helhet (`excluded.metadata`), og fram til august 2026 tok
 * den med seg disse nøklene på veien. Den inkrementelle Withings-synken henter
 * sju dagers overlapp hvert femte minutt for å fange retroaktive revisjoner, så
 * en økt du hadde skjult var tilbake i lista lenge før neste morgen — og siden
 * raden så identisk ut, fantes det ingen feilmelding å lete etter.
 *
 * Nøklene her settes utelukkende av eksplisitte brukerhandlinger
 * (`/api/workouts/[activityId]/dismiss` og `.../source-role`) og skal overleve
 * enhver re-synk av den samme raden: valget gjelder AKTIVITETEN, ikke den
 * bestemte payloaden kilden hadde da valget ble tatt. Synken får fortsatt
 * revidere sine egne felt fritt.
 *
 * Legger du til en ny brukerstyrt metadata-nøkkel, hører den hjemme her —
 * ellers lever den til neste synk av raden.
 */
export const USER_OWNED_METADATA_KEYS = [
	/** Hele økta er skjult fra oversikten (klynge-nivå). */
	'dismissed',
	/** Én kilde-registrering er avvist; aktiviteten består på de gjenværende. */
	'sourceRejected',
	/** Denne kilden vinner på distanse/tempo/høyde. */
	'preferGps',
	/** Denne kilden vinner på puls. */
	'preferHr'
] as const;

export type UserOwnedMetadataKey = (typeof USER_OWNED_METADATA_KEYS)[number];

/**
 * Fletter brukerens valg tilbake over metadataen synken nettopp skrev.
 *
 * Brukerens nøkler vinner; alt annet kommer fra synken. En nøkkel som ikke
 * finnes på den eksisterende raden skal ikke materialisere seg som `null` i
 * resultatet — `metadata.dismissed === null` og «ingen dismissed» må se like ut
 * for leserne, som sjekker på `=== true`.
 *
 * Speiler SQL-uttrykket i `SensorEventService`; finnes her i ren form slik at
 * semantikken kan testes uten database.
 */
export function mergeUserOwnedMetadata(
	existing: Record<string, unknown> | null | undefined,
	incoming: Record<string, unknown> | null | undefined
): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...(incoming ?? {}) };
	for (const key of USER_OWNED_METADATA_KEYS) {
		const value = existing?.[key];
		if (value === undefined || value === null) continue;
		merged[key] = value;
	}
	return merged;
}
