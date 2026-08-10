/**
 * Vakt for rå lesing av `sensor_events`.
 *
 * Bakgrunn: flere `data_type`-verdier skrives av flere kilder som beskriver
 * SAMME virkelighet med litt ulike tall og tidsstempler. Én løpetur skrives av
 * Withings-klokka, GPX-fila fra Dropbox og Ekko-opplastingen; vekt lagres med
 * to ulike betydninger av måletype 6 gjennom historikken. Kunnskapen om hvordan
 * de skal slås sammen bor i delte lesere — men et lag hjelper ikke hvis det er
 * valgfritt.
 *
 * Målingen som utløste denne vakten (august 2026): 17 filer leste vekt-events,
 * og **2** av dem gikk gjennom `normalizeBodyComposition` som CLAUDE.md sier at
 * man alltid skal bruke. Widget-tallet for løpedistanse viste 80,9 km der
 * brukeren hadde løpt drøyt 40, fordi endepunktet summerte rå rader.
 *
 * Vakten er en **skralle**, ikke en opprydding: dagens lesere er frosset i
 * `knownRawReaders`, og en ny fil som leser rått feiler testen. Å legge seg selv
 * til på lista er lov — men det er en bevisst redigering med en begrunnelse,
 * ikke noe som skjer i forbifarten.
 *
 * Se `docs/changelog/2026-08-08-widget-loepedistanse-dobbelttelling.md` og
 * `2026-08-08-ivrig-autohaking.md`.
 */

export type GuardedDataType = {
	/** `data_type`-verdien i basen. */
	dataType: string;
	/** Hva en ny leser skal bruke i stedet. Vises i feilmeldingen. */
	use: string;
	/** Hvorfor rå lesing er farlig for akkurat denne typen. */
	why: string;
	/**
	 * Filer (relativt til `src/`) som leser typen rått i dag, og som er vurdert.
	 * Lista skal krympe, aldri vokse uten en begrunnelse i kommentaren.
	 */
	knownRawReaders: string[];
};

export const GUARDED_DATA_TYPES: GuardedDataType[] = [
	{
		dataType: 'workout',
		use: 'readDeduplicatedWorkouts fra $lib/server/workouts/deduplicated-workouts',
		why: 'Samme økt skrives av opptil tre kilder (Withings, GPX i Dropbox, Ekko) med startpunkter som spriker minutter. Rå telling gir tre økter av én tur.',
		knownRawReaders: [
			// Selve dedupliseringen — den MÅ lese rått.
			'lib/server/activity-layer.ts',
			// Én bestemt økt hentet på id, ikke en aggregering over flere.
			'lib/server/walk-playback.ts',
			'lib/server/workout-context.ts',
			'routes/api/apps/walks/[eventId]/share/+server.ts',
			'routes/api/apps/strava/sync/+server.ts',
			// Per kilde er hele poenget: «hva kom inn fra hvem».
			'lib/server/withings-sync-notifications.ts',
			'routes/settings/sources/+page.server.ts',
			// Skrive-/vedlikeholdsstier som opererer på rå rader.
			'routes/api/admin/cleanup-walking/+server.ts',
			'routes/api/tema/[id=uuid]/trip/import-walk/+server.ts',
			// Backfill av bevegelsestid: trenger sporpunktene per KILDE-rad, og det
			// er kilde-raden `data.movingDuration` skrives tilbake på. Den delte
			// leseren gir klynger, ikke rader, og kan derfor ikke brukes her.
			'lib/server/health/moving-time-backfill.ts',
			// Dokumentert unntak: canonical_workouts stripper exercises[], så
			// styrkeøkter må leses rått. Utholdenhet leses allerede fra canonical.
			'lib/server/tracks/repository.ts',
			'lib/server/tracks/routes-repository.ts',
			// Gjeld — aggregerer over økter og bør flyttes til den delte leseren.
			'lib/server/sensor-goal-automation.ts',
			'lib/server/workout-nuggets.ts',
			'routes/api/sensor-summary/+server.ts',
			// Summerer Withings' egne økt-kalorier som kryssjekk. Bare Withings-rader
			// har feltet i dag, så det dobbeltteller ikke — men det gjør det den dagen
			// en annen kilde begynner å sende `calories`.
			'lib/server/nutrition/expenditure.ts'
		]
	},
	{
		dataType: 'weight',
		use: 'normalizeBodyComposition fra $lib/domain/health/body-composition (og weight-series for trend)',
		why: 'Måletype 6 ble lagret som `data.fatMass` og lest som kilo — et fettmasse-mål viste 22 der svaret var 18. Gamle og nye rader har ulik betydning av samme felt.',
		knownRawReaders: [
			// Leser kroppssammensetning gjennom normalisatoren.
			'lib/server/goal-progress.ts',
			'lib/server/weight-dashboard.ts',
			// Leser bare `data.weight` (ett felt, én betydning gjennom historikken).
			'lib/ai/tools/manage-nutrition-targets.ts',
			'lib/server/health/effort-weight-data.ts',
			'lib/server/nutrition/energy-context.ts',
			'lib/server/nutrition/intraday.ts',
			'lib/server/withings-sync-notifications.ts',
			'routes/api/month-plan/complete/+server.ts',
			'routes/api/month-plan/context/+server.ts',
			'routes/api/tema/[id=uuid]/health-stats/+server.ts',
			'routes/api/week-plan/complete/+server.ts',
			'routes/api/week-plan/context/+server.ts',
			'routes/api/weight/+server.ts',
			'routes/maanedsplan/+page.server.ts',
			'routes/samtaler/+page.server.ts',
			'routes/settings/profile/+page.server.ts',
			'routes/ukeplan/+page.server.ts',
			// Spør om en rad FINNES på en Oslo-dag, ikke hva den måler — dagnivå-
			// dedupen i HealthKit-backfillen. Normalisering ville ikke endret svaret.
			'routes/api/apps/healthkit/weight/+server.ts',
			// Trenger `sensor_events.id` for å kunne slette en enkeltmåling, og
			// `toWeightMeasurements` kaster id-en. Leser bare `data.weight` — ett felt
			// med én betydning gjennom historikken. Kroppssammensetningen, som er den
			// tvetydige delen, brukes ikke her.
			'lib/server/health/weight-measurement-store.ts',
			// Skrivesti, og den MÅ se de lagrede feltene rått: jobben avgjør hvilke
			// felt som MANGLER på raden, og en normalisator som utleder fettmasse fra
			// prosent ville skjult nettopp hullet den skal fylle. Den skriver aldri
			// over et felt som finnes, så tvetydigheten i `fatMass` bevares urørt.
			'lib/server/integrations/withings-weight-enrichment.ts'
		]
	},
	{
		dataType: 'sleep',
		use: 'nightKeyForTime + isNapSleepEvent (natt-nøkling og dupp-filtrering) — se sleep-dashboard for mønsteret',
		why: 'Withings deler natta i flere segmenter, dagsøvner ligger på samme dataType, og nattnøkkelen er datoen du VÅKNER. Rå gruppering per UTC-dato gir feil netter.',
		knownRawReaders: [
			'lib/server/checklist-autocheck.ts',
			'lib/server/goal-progress.ts',
			'lib/server/integrations/sleep-goals.ts',
			'lib/server/integrations/withings-sleep-hrv.ts',
			'lib/server/integrations/withings-sync.ts',
			'lib/server/programs/readiness.ts',
			'lib/server/services/signal-service.ts',
			'lib/server/sleep-dashboard.ts',
			'routes/api/admin/debug-sleep/+server.ts',
			'routes/api/tema/[id=uuid]/health-stats/+server.ts'
		]
	}
];

/**
 * Finner rå lesing av en `data_type` i en kildefil.
 *
 * Dekker både rå SQL (`data_type = 'workout'`, `data_type IN (...)`) og
 * query-builderen (`eq(sensorEvents.dataType, 'workout')`,
 * `inArray(sensorEvents.dataType, [...])`).
 *
 * **Skriving treffes ikke:** `dataType: 'workout'` bruker kolon, og en sensor
 * som skriver sin egen rad har ingen sammenslåing å gjøre.
 */
export function readsRawDataType(source: string, dataType: string): boolean {
	const escaped = dataType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const quoted = `['"\`]${escaped}['"\`]`;
	const patterns = [
		// data_type = 'workout'
		new RegExp(`data_type\\s*=\\s*${quoted}`),
		// data_type IN ('workout', 'strength_workout')
		new RegExp(`data_type\\s+IN\\s*\\([^)]*${quoted}`, 'i'),
		// eq(sensorEvents.dataType, 'workout')
		new RegExp(`dataType\\s*,\\s*${quoted}`),
		// inArray(sensorEvents.dataType, ['workout', …])
		new RegExp(`dataType\\s*,\\s*\\[[^\\]]*${quoted}`)
	];
	return patterns.some((pattern) => pattern.test(source));
}
