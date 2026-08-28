/**
 * Løpte kilometer per dag, hele historikken.
 *
 * ## Hvorfor `canonical_workouts` og ikke aktivitetslista
 *
 * Trenings-dashboardet leser 400 dager (`WORKOUT_LOOKBACK_DAYS`), som er nok til
 * belastning og form, men ikke til å legge år oppå hverandre. `canonical_workouts`
 * ER den lagrede dedupliserte utgaven — samme tur skrevet av klokka, Dropbox og
 * Ekko teller én gang — og `loadDistanceRecords` leser den alt uten datogrense av
 * samme grunn. Å bygge klyngene på nytt over ni år ved hver sidelast ville vært
 * den samme jobben, gjort dyrt.
 *
 * ## Dagsnøkkelen er Oslo-tid
 *
 * En kveldsøkt 31. desember kl. 23 er en økt det året. Med UTC-datoen ville den
 * flyttet seg til året etter i sesongkurven — og «hittil i år» ville startet med
 * en tur som ikke var i år.
 *
 * ## Distansen normaliseres, aldri leses rått
 *
 * `normalizeDistanceMeters` tolker verdier ≤ 80 som kilometer. Uten den blir en
 * rad med 8,1 til 8,1 meter, og året får et hull der en langtur var.
 */

import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { canonicalWorkouts } from '$lib/db/schema';
import { normalizeDistanceMeters } from '$lib/server/activity-layer';
import { osloDayKey } from '$lib/domain/oslo-time';
import type { DayValue } from '$lib/domain/health/cycle-series';

/**
 * Hvor langt tilbake sesongkurvene leser.
 *
 * Ti år er ti linjer, og ti er alt for mange å skille — men de eldste er
 * bakgrunn, ikke noe man leser av. Taket finnes for payloadens skyld, og
 * `maxSeries` i `buildCycleSeries` er det som avgjør hvor mange som TEGNES.
 */
export const RUNNING_HISTORY_DAYS = 3660;

export interface RunningHistory {
	/** Kilometer per dag med løping, stigende. Dager uten løping mangler. */
	days: DayValue[];
	/** Første dagen med en registrert løpetur, eller null. */
	firstDay: string | null;
	/**
	 * Dagens Oslo-dato.
	 *
	 * Følger med payloaden framfor å regnes i komponenten: det er serveren som
	 * vet hvilken dag dataene er hentet for, og «hvilken periode er nå» må være
	 * det samme spørsmålet som grupperingen over ble gjort med.
	 */
	today: string;
}

export async function loadRunningHistory(
	userId: string,
	sportFamily = 'running'
): Promise<RunningHistory> {
	const since = new Date(Date.now() - RUNNING_HISTORY_DAYS * 86_400_000);

	const rows = await db
		.select({
			startTime: canonicalWorkouts.startTime,
			distanceMeters: canonicalWorkouts.distanceMeters
		})
		.from(canonicalWorkouts)
		.where(
			and(
				eq(canonicalWorkouts.userId, userId),
				eq(canonicalWorkouts.sportFamily, sportFamily),
				gte(canonicalWorkouts.startTime, since),
				isNotNull(canonicalWorkouts.distanceMeters)
			)
		);

	const byDay = new Map<string, number>();
	for (const row of rows) {
		const meters = normalizeDistanceMeters(Number(row.distanceMeters));
		if (meters === null || meters <= 0) continue;
		const day = osloDayKey(row.startTime);
		byDay.set(day, (byDay.get(day) ?? 0) + meters / 1000);
	}

	const days = [...byDay.entries()]
		.map(([date, km]) => ({ date, value: Math.round(km * 100) / 100 }))
		.sort((a, b) => (a.date < b.date ? -1 : 1));

	return { days, firstDay: days[0]?.date ?? null, today: osloDayKey(new Date()) };
}
