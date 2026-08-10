/**
 * fuel-nudge.ts — nudgen som sier fra før sultkrisa.
 *
 * Mønster fra `grocery-nudge.ts`: timebasert cron, lokal tidsmatching og dedup via
 * `nudge_events`. Beslutningen om *hva* som skal sies bor i
 * `$lib/domain/nutrition/fuel-nudge`, som er ren og testet; denne fila henter data
 * og leverer.
 *
 * **Én per dag per bruker.** En nudge som fyrer flere ganger blir bakgrunnsstøy,
 * og bakgrunnsstøy blir slått av.
 */

import { and, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { canonicalWorkouts, nudgeEvents, themes, users } from '$lib/db/schema';
import { createNudgeEvent, markNudgeSent } from '$lib/server/nudge-events';
import {
	getGoogleChatWebhooksForRoutes,
	resolveRoutesForNotification,
	routeTargetsPwa
} from '$lib/server/notification-channels';
import { sendGoogleChatMessage } from '$lib/server/google-chat';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import { listIntake } from '$lib/server/nutrition/intake-log';
import { loadNutritionTargets } from '$lib/server/nutrition/targets';
import { groupBySlot, osloDateKey, summarizeDay } from '$lib/domain/nutrition/day-summary';
import { describeIntakePacing, osloHourNow } from '$lib/domain/nutrition/intake-pacing';
import { repeatableMeals } from '$lib/domain/nutrition/repeat-meals';
import { evaluateMacroTargets } from '$lib/domain/nutrition/macro-targets';
import { decideFuelNudge } from '$lib/domain/nutrition/fuel-nudge';
import { predictHunger } from '$lib/domain/nutrition/hunger';
import { loadIntradayEnergy } from '$lib/server/nutrition/intraday';
import { listHunger } from '$lib/server/nutrition/hunger-log';
import { estimateWorkoutKcal } from '$lib/domain/health/energy-expenditure';
import { readBodyProfile } from '$lib/server/health/body-profile';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import type { MealSlotId } from '$lib/domain/nutrition/meal-slots';

const NUDGE_TYPE = 'fuel_snack';

/**
 * Vekta MET-regningen bruker her.
 *
 * Nudgen trenger bare å vite om økta kostet *nok* til å endre rådet, ikke det
 * presise tallet — terskelen er 250 kcal. Å hente siste vektmåling for hver bruker
 * i en time-cron er en spørring per bruker for en presisjon ingen ser.
 */
const NUDGE_WEIGHT_KG = 80;

async function alreadySentToday(userId: string, todayKey: string): Promise<boolean> {
	const rows = await db
		.select({ id: nudgeEvents.id })
		.from(nudgeEvents)
		.where(
			and(
				eq(nudgeEvents.userId, userId),
				eq(nudgeEvents.nudgeType, NUDGE_TYPE),
				gte(nudgeEvents.createdAt, new Date(`${todayKey}T00:00:00.000Z`))
			)
		)
		.limit(1);
	return rows.length > 0;
}

async function findNutritionThemeUrl(userId: string, appUrl: string): Promise<string> {
	const rows = await db
		.select({ id: themes.id, name: themes.name })
		.from(themes)
		.where(eq(themes.userId, userId));
	const theme = rows.find((t) => resolveThemeDashboardKind(t.name) === 'nutrition');
	return theme ? `${appUrl}/tema/${theme.id}` : appUrl;
}

export async function sendFuelNudge(
	userId: string,
	user: typeof users.$inferSelect,
	appUrl: string,
	now: Date = new Date(),
	opts: { force?: boolean } = {}
): Promise<{ sent: boolean; reason: string }> {
	const today = osloDateKey(now);

	if (!opts.force && (await alreadySentToday(userId, today))) {
		return { sent: false, reason: 'already-sent-today' };
	}

	const since = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000);
	const [entries, targets, profile] = await Promise.all([
		listIntake(userId, { since }),
		loadNutritionTargets(userId),
		readBodyProfile(userId)
	]);

	// Uten et kcal-mål kan vi ikke si om noen ligger «bak skjema» — det er en
	// andel av noe. Da holder vi kjeft framfor å gjette et mål.
	if (targets.kcal === null) return { sent: false, reason: 'no-kcal-target' };

	const todayEntries = entries.filter((entry) => osloDateKey(entry.timestamp) === today);
	const summary = summarizeDay(today, todayEntries, targets);

	const kcalBySlot: Partial<Record<MealSlotId, number>> = {};
	for (const group of groupBySlot(todayEntries)) {
		if (group.slot) kcalBySlot[group.slot] = Math.round(group.totals.kcal);
	}

	const dayStart = new Date(`${today}T00:00:00.000Z`);
	const workoutRows = await db.query.canonicalWorkouts.findMany({
		columns: { startTime: true, sportType: true, durationSeconds: true, movingSeconds: true, distanceMeters: true },
		where: and(
			eq(canonicalWorkouts.userId, userId),
			gte(canonicalWorkouts.startTime, new Date(dayStart.getTime() - 12 * 60 * 60 * 1000))
		)
	});

	const workouts = workoutRows
		.filter((row) => osloDateKey(row.startTime) === today)
		.flatMap((row) => {
			const estimate = estimateWorkoutKcal(
				{
					sportType: row.sportType,
					durationSeconds: row.durationSeconds ? Number(row.durationSeconds) : null,
					movingSeconds: row.movingSeconds ? Number(row.movingSeconds) : null,
					distanceMeters: row.distanceMeters ? Number(row.distanceMeters) : null
				},
				NUDGE_WEIGHT_KG
			);
			if (!estimate) return [];
			return [
				{
					sportType: row.sportType ?? 'ukjent',
					kcal: estimate.kcal,
					distanceKm: row.distanceMeters ? Number(row.distanceMeters) / 1000 : null
				}
			];
		});

	// Sultmodellen og det kumulative gapet. Samme loader flaten bruker, så en nudge
	// aldri kan fyre på et gap flaten ikke viste.
	const [intraday, hungerHistory] = await Promise.all([
		loadIntradayEnergy(userId, now),
		listHunger(userId)
	]);
	const hunger = predictHunger({
		history: hungerHistory,
		gapNowKcal: intraday?.gapNow ?? null
	});

	const macroTargets = evaluateMacroTargets({ totals: summary.totals, targets });
	const nudge = decideFuelNudge({
		hunger,
		gapNowKcal: intraday?.gapNow ?? null,
		osloHour: osloHourNow(now),
		pacing: describeIntakePacing({
			kcalSoFar: summary.totals.kcal,
			proteinSoFar: summary.totals.proteinG,
			targetKcal: targets.kcal,
			targetProteinG: targets.proteinG,
			osloHour: osloHourNow(now)
		}),
		kcalBySlot,
		workouts,
		repeatable: repeatableMeals(entries),
		proteinGapG: macroTargets.macros.find((m) => m.key === 'protein')?.gapG ?? null
	});

	if (!nudge) return { sent: false, reason: 'nothing-to-say' };

	const themeUrl = await findNutritionThemeUrl(userId, appUrl);

	const lines = [nudge.body];
	if (nudge.suggestions.length > 0) {
		lines.push('');
		lines.push(
			nudge.askHunger ? 'Noe du ofte tar:' : 'Forslag fra det du pleier å spise:'
		);
		for (const suggestion of nudge.suggestions) {
			lines.push(
				`• ${suggestion.label} — ${Math.round(suggestion.macros.kcal)} kcal, ${Math.round(suggestion.macros.proteinG)} g protein`
			);
		}
	}
	lines.push('');
	lines.push(`Logg med ett trykk: ${themeUrl}`);

	const eventId = await createNudgeEvent({
		userId,
		nudgeType: NUDGE_TYPE,
		mode: nudge.askHunger ? 'interactive' : 'announce',
		context: {
			kind: nudge.kind,
			kcalSoFar: Math.round(summary.totals.kcal),
			targetKcal: targets.kcal,
			profileComplete: profile.complete
		}
	});

	const routes = await resolveRoutesForNotification(user, 'fuelSnack');
	let sent = false;

	if (routeTargetsPwa(routes)) {
		try {
			const delivery = await PushDeliveryService.deliverToUser({
				userId,
				payload: {
					title: nudge.headline,
					body: nudge.body,
					url: themeUrl,
					tag: `fuel-snack-${today}`
				},
				onGone: 'disable'
			});
			if (delivery.sent > 0) sent = true;
		} catch {
			// Ikke fatalt — Google Chat under er den andre kanalen.
		}
	}

	for (const webhook of getGoogleChatWebhooksForRoutes(user, routes)) {
		const ok = await sendGoogleChatMessage(webhook, {
			text: `🍽 ${nudge.headline}\n\n${lines.join('\n')}`
		});
		if (ok) sent = true;
	}

	if (sent && eventId) await markNudgeSent(eventId);
	return { sent, reason: sent ? nudge.kind : 'delivery-failed' };
}

export async function sendFuelNudgesForAllUsers(
	appUrl: string,
	now: Date = new Date(),
	opts: { force?: boolean } = {}
) {
	const allUsers = await db.query.users.findMany();
	const results: Array<{ userId: string; sent: boolean; reason: string }> = [];

	for (const user of allUsers) {
		try {
			results.push({ userId: user.id, ...(await sendFuelNudge(user.id, user, appUrl, now, opts)) });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[fuel-nudge] user=${user.id} error: ${message}`);
			results.push({ userId: user.id, sent: false, reason: `error: ${message}` });
		}
	}

	return {
		processedUsers: results.length,
		nudgesSent: results.filter((r) => r.sent).length,
		results
	};
}
