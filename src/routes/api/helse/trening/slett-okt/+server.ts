import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, gte, lt } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/admin-auth';
import { removeWorkouts } from '$lib/server/workouts/workout-cleanup';
import {
	looksMislabelled,
	planRemoval,
	type RemovalCandidate
} from '$lib/domain/health/workout-removal';

/**
 * Sletter en økt OG rydder etter seg.
 *
 * `POST /api/helse/trening/slett-okt?date=YYYY-MM-DD[&sport=running][&dryRun=false]`
 *
 * `dryRun` er **sant som standard**: en sletting man ikke har sett planen for er
 * ikke en beslutning. Kall den først uten `dryRun=false` og les `candidates`.
 *
 * ## Hvorfor den finnes
 *
 * Felttest 17. august 2026: en elsykkeltur til jobb ble lagret som løping, og
 * «tidenes raskeste 5 km» havnet i Ekko, Resonans og Strava. `cleanup-walking`
 * viste hvorfor en `DELETE FROM sensor_events` ikke er nok — rekorden, effort-skåren
 * og formkurven leser fra `canonical_workouts` og `sensor_aggregates`, som står igjen
 * og fortsetter å lyve.
 *
 * Rekkefølgen er ikke tilfeldig: canonical og varsler slettes FØR kilderadene, så en
 * feil halvveis etterlater rader vi kan finne igjen på nytt framfor foreldreløse
 * projeksjoner. Reaggregeringen kommer sist, når det ikke er mer å lese.
 *
 * ## Hva den bevisst IKKE gjør
 *
 * Ruller ikke tilbake autohaking eller målprogresjon — vi haker aldri av automatisk
 * (`docs/changelog/2026-08-08-ivrig-autohaking.md`). Og den rører ikke Strava; den
 * kopien eier vi ikke. Begge sies i svarets `notCleaned`.
 */
export const POST: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals.userId);
	const userId = locals.userId;

	const date = url.searchParams.get('date');
	if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		return json({ error: 'date=YYYY-MM-DD mangler eller er ugyldig' }, { status: 400 });
	}
	const sport = url.searchParams.get('sport');
	const dryRun = url.searchParams.get('dryRun') !== 'false';

	// Oslo-døgnet krysser UTC-midnatt, så vinduet padder et døgn i hver ende og
	// filtreres presist etterpå. Å bruke UTC-datoen direkte ville mistet en økt
	// om morgenen eller tatt en fra dagen før.
	const from = new Date(`${date}T00:00:00Z`);
	from.setUTCDate(from.getUTCDate() - 1);
	const to = new Date(`${date}T00:00:00Z`);
	to.setUTCDate(to.getUTCDate() + 2);

	const rows = await db
		.select({
			id: sensorEvents.id,
			timestamp: sensorEvents.timestamp,
			data: sensorEvents.data
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'workout'),
				gte(sensorEvents.timestamp, from),
				lt(sensorEvents.timestamp, to)
			)
		);

	const osloDay = (d: Date) =>
		new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(d);

	const candidates: RemovalCandidate[] = rows
		.filter((r) => osloDay(r.timestamp) === date)
		.map((r) => {
			const data = (r.data ?? {}) as Record<string, unknown>;
			const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
			return {
				eventId: r.id,
				startTime: r.timestamp,
				sportType: typeof data.sportType === 'string' ? data.sportType : null,
				distanceMeters: num(data.distance),
				durationSeconds: num(data.duration),
				provider: typeof data.provider === 'string' ? data.provider : null
			};
		})
		.filter((c) => (sport ? c.sportType === sport : true));

	const plan = planRemoval(candidates);
	const flagged = candidates.filter(looksMislabelled).map((c) => c.eventId);

	if (dryRun || plan.reaggregateFrom === null) {
		return json({
			dryRun: true,
			date,
			sport,
			candidates: plan.candidates,
			looksMislabelled: flagged,
			reaggregateFrom: plan.reaggregateFrom,
			notCleaned: plan.notCleaned,
			hint: 'Legg til &dryRun=false for å slette.'
		});
	}

	// Kjeden er delt med Ekko-endepunktet (`/api/apps/workouts/[sessionId]`). To
	// implementasjoner av «rydd etter en økt» ville drevet fra hverandre, og den ene ville
	// glemt et lag — som er nøyaktig det `cleanup-walking` gjorde.
	const result = await removeWorkouts(userId, candidates);

	return json({ dryRun: false, date, sport, ...result });
};
