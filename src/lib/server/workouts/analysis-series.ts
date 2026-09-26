import { sql } from 'drizzle-orm';
import { sensorEvents } from '$lib/db/schema';
import type { TrackPoint } from '$lib/server/workouts/workout-analytics';

/**
 * Tidsserien øktanalysen (`analyzeWorkout`) skal lese, hentet i SQL: sporet når
 * raden har et (to punkter eller flere), ellers innendørs-samplene (`data.samples`).
 *
 * Mølleøkter fra Ekko har ingen posisjon, men en pulskurve. Uten dette fikk de
 * aldri sonefordeling eller tidsdeling – analysen leste bare `trackPoints`, og det
 * er tomt for en økt på stedet. Samplene bærer `dist`, som `workout-analytics`
 * bruker i stedet for haversine. Se `$lib/domain/health/workout-samples.ts`.
 *
 * Ett fragment for alle fire leserne (projeksjonen, reanalyze, analyse-endepunktet
 * og athlete-context), så de ikke kan bli uenige om hvilken serie en økt har.
 */
// Nøstet CASE, ikke `typeof = 'array' AND length >= 2`: Postgres lover ingen
// rekkefølge i en AND, og `jsonb_array_length` feiler på noe som ikke er en liste.
// CASE er den dokumenterte måten å tvinge rekkefølgen på.
export const analysisSeriesSql = sql<TrackPoint[] | null>`CASE
	WHEN jsonb_typeof(${sensorEvents.data}->'trackPoints') = 'array' THEN
		CASE
			WHEN jsonb_array_length(${sensorEvents.data}->'trackPoints') >= 2 THEN ${sensorEvents.data}->'trackPoints'
			ELSE ${sensorEvents.data}->'samples'
		END
	ELSE ${sensorEvents.data}->'samples'
END`;
