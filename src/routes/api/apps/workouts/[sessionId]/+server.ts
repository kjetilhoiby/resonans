import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	correctWorkoutSport,
	findEkkoWorkoutEvents,
	removeWorkouts
} from '$lib/server/workouts/workout-cleanup';
import { looksMislabelled } from '$lib/domain/health/workout-removal';
import { normalizeSportType } from '$lib/utils/sport';

/**
 * «Rett og slett» fra Ekko — én økt, hele kaskaden.
 *
 * - `PATCH /api/apps/workouts/<sessionId>` `{ "sportType": "e_bike" }` — retter idretten
 * - `DELETE /api/apps/workouts/<sessionId>` — fjerner økta
 *
 * ## Hvorfor det finnes
 *
 * Felttest 17. august 2026: en elsykkeltur til jobb ble lagret som løping, og «tidenes
 * raskeste 5 km» havnet i Ekko, Resonans og Strava. Å rydde det krevde et curl-kall mot et
 * admin-endepunkt — altså ikke en funksjon, men et verktøy for den som skrev koden.
 *
 * Kravet er at et trykk i Ekko skal rette tilstanden overalt vi styrer API-et. Ekko eier
 * sin egen kopi og Apple Health (`HealthKitExporter.reexport` sletter og skriver på nytt);
 * dette endepunktet eier Resonans-siden: kilderaden, projeksjonen, aggregatene, og dermed
 * rekordene og formkurven som leser fra dem.
 *
 * ## Retting er hovedveien
 *
 * Turen skjedde. 8,3 km elsykkel er ekte data — det var merkelappen som var feil, og en
 * retting beholder dem. Sletting hører til ekte søppel, som en fantomøkt på halvannet
 * minutt. Derfor er PATCH den brede stien og DELETE den smale.
 *
 * ## Avgrensning
 *
 * Bare rader Ekko selv skrev (`data.sessionId`). Beskriver klokka eller Dropbox den samme
 * turen, står de igjen — de er ikke våre å rette herfra, og dedupliseringen tar dem fra da
 * av. Svaret sier `matched: 0` i det tilfellet framfor å late som noe ble gjort.
 */

/**
 * Idrettene en retting kan sette.
 *
 * Lista er smalere enn skrivestien med vilje — `/api/apps/upload` tar imot hva som helst
 * og normaliserer — men den MÅ dekke alt Ekko kan ha lastet opp (`treadmill` er Ekkos egen
 * verdi og overlever normaliseringen), ellers kan en økt ikke rettes tilbake til det den var.
 */
const SPORT_TYPES = new Set([
	'running',
	'trail_running',
	'indoor_running',
	'treadmill',
	'cycling',
	'indoor_cycling',
	'e_bike',
	'walking',
	'indoor_walking',
	'hiking',
	'ski',
	'swimming',
	'yoga',
	'strength'
]);

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'ikke_innlogget' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as { sportType?: unknown };
	// Normaliseres FØR validering, av samme grunn som i opplastingen: Ekko sender sin egen
	// `eBiking`, og appen skal ikke måtte kjenne Resonans' kanoniske vokabular. Uten dette
	// ville en retting til elsykkel — nettopp den 17. august krevde — blitt avvist som ukjent.
	const sportType = normalizeSportType(typeof body.sportType === 'string' ? body.sportType : null);
	if (!sportType || !SPORT_TYPES.has(sportType)) {
		// Et ukjent navn ville skrevet en idrett ingen leser kjenner, og økta ville
		// forsvunnet fra alle familiefiltre uten at noe sa fra.
		return json(
			{ error: 'ukjent_idrett', kjente: [...SPORT_TYPES].sort() },
			{ status: 400 }
		);
	}

	const candidates = await findEkkoWorkoutEvents(userId, params.sessionId);
	if (candidates.length === 0) {
		return json({ matched: 0, hint: 'Ingen Ekko-rader for denne økta.' }, { status: 404 });
	}

	const result = await correctWorkoutSport(userId, candidates, sportType);
	return json({ matched: candidates.length, ...result });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'ikke_innlogget' }, { status: 401 });

	const candidates = await findEkkoWorkoutEvents(userId, params.sessionId);
	if (candidates.length === 0) {
		return json({ matched: 0, hint: 'Ingen Ekko-rader for denne økta.' }, { status: 404 });
	}

	const result = await removeWorkouts(userId, candidates);
	return json({
		matched: candidates.length,
		// Hvorfor den ble mistenkt: nyttig i loggen når man i ettertid spør hva som ble
		// slettet og hvorfor. Påvirker ingenting — slettingen ble bedt om.
		looksMislabelled: candidates.filter(looksMislabelled).map((c) => c.eventId),
		...result
	});
};
