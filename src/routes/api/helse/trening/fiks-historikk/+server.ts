import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { canonicalWorkouts, sensorEvents } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/admin-auth';
import { planHistoryRepair } from '$lib/domain/health/history-repair-plan';

/**
 * Planen for «Fiks treningshistorikk».
 *
 * `GET /api/helse/trening/fiks-historikk`
 *
 * ## Hvorfor endepunktet bare PLANLEGGER
 *
 * Reparasjonen er to rørledninger i en bestemt rekkefølge, og den første må
 * kjøres i vinduer på 26 uker fordi projeksjonen laster pulskurven for hver
 * løpeøkt i vinduet. Selve løkka over vinduene går i KLIENTEN — samme mønster
 * som `WorkoutReanalyzeCard`: en serverside-løkke ville truffet svartidsgrensa,
 * og en halvferdig jobb uten framdriftstall er verre enn en som teller.
 *
 * Dette endepunktet svarer derfor bare på **hvor historikken begynner** og
 * **hvilke kall som må gjøres**. Kallene finnes fra før:
 * `POST /api/helse/trening/reprojiser?weeks=26&until=…` per vindu, deretter
 * `POST /api/sensors/aggregate` én gang.
 *
 * ## Hvorfor startpunktet leses fra `sensor_events`, ikke fra canonical
 *
 * `canonical_workouts` er nettopp tabellen som kan mangle rader — det er hele
 * grunnen til at knappen finnes. Leste planen sin egen startdato derfra, ville
 * et hull i den eldste enden gjort reparasjonen ute av stand til å nå de
 * radene: verktøyet ville brukt skaden som grense for hva det kan reparere.
 * `sensor_events` er kilden ingen projeksjon rører.
 *
 * Svaret rapporterer BEGGE, fordi differansen er en observasjon: starter
 * canonical mye senere enn historikken, mangler det rader.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.userId) return json({ error: 'Ikke innlogget.' }, { status: 401 });

	const requested = url.searchParams.get('userId')?.trim();
	if (requested && requested !== locals.userId) await requireAdmin(locals.userId);
	const userId = requested || locals.userId;

	const [rawSpan, canonicalSpan] = await Promise.all([
		readRawWorkoutSpan(userId),
		readCanonicalSpan(userId)
	]);

	if (!rawSpan.firstIso) {
		return json({
			success: true,
			hasHistory: false,
			message: 'Ingen treningsøkter registrert — ingenting å reparere.'
		});
	}

	const plan = planHistoryRepair({
		historyStartIso: rawSpan.firstIso,
		nowIso: new Date().toISOString()
	});

	return json({
		success: true,
		hasHistory: true,
		history: {
			firstDay: rawSpan.firstIso.slice(0, 10),
			lastDay: rawSpan.lastIso?.slice(0, 10) ?? null,
			events: rawSpan.count
		},
		canonical: {
			firstDay: canonicalSpan.firstIso?.slice(0, 10) ?? null,
			lastDay: canonicalSpan.lastIso?.slice(0, 10) ?? null,
			rows: canonicalSpan.count
		},
		plan
	});
};

/**
 * Spennet i det RÅ laget: første og siste `workout`-hendelse.
 *
 * Teller hendelser, ikke økter — samme tur skrives av opptil tre kilder, så
 * `events` er alltid høyere enn antall økter. Tallet er med for å svare på «har
 * vi i det hele tatt data her», ikke for å sammenlignes med `canonical.rows`.
 */
async function readRawWorkoutSpan(userId: string): Promise<{
	firstIso: string | null;
	lastIso: string | null;
	count: number;
}> {
	const rows = await db
		.select({
			first: sql<string | null>`min(${sensorEvents.timestamp})`,
			last: sql<string | null>`max(${sensorEvents.timestamp})`,
			count: sql<number>`count(*)::int`
		})
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'workout')));

	const row = rows[0];
	return {
		firstIso: row?.first ? new Date(row.first).toISOString() : null,
		lastIso: row?.last ? new Date(row.last).toISOString() : null,
		count: Number(row?.count ?? 0)
	};
}

async function readCanonicalSpan(userId: string): Promise<{
	firstIso: string | null;
	lastIso: string | null;
	count: number;
}> {
	const rows = await db
		.select({
			first: sql<string | null>`min(${canonicalWorkouts.startTime})`,
			last: sql<string | null>`max(${canonicalWorkouts.startTime})`,
			count: sql<number>`count(*)::int`
		})
		.from(canonicalWorkouts)
		.where(eq(canonicalWorkouts.userId, userId));

	const row = rows[0];
	return {
		firstIso: row?.first ? new Date(row.first).toISOString() : null,
		lastIso: row?.last ? new Date(row.last).toISOString() : null,
		count: Number(row?.count ?? 0)
	};
}
