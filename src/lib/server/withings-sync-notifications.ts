import { db } from '$lib/db';
import { users, sensorEvents } from '$lib/db/schema';
import { eq, and, gte } from 'drizzle-orm';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import { ensureThemeForUser, findThemeByName } from '$lib/server/themes';
import { HEALTH_PARENT_THEME_NAME } from '$lib/domain/health-subthemes';
import { computeWeightPush } from '$lib/server/health/weight-nugget';

export async function notifyWithingsSyncResults(args: {
	userId: string;
	appUrl: string;
	syncStartTime: Date;
	synced: { weight: number; workouts: number };
}) {
	const { userId, appUrl, syncStartTime, synced } = args;
	if (synced.weight === 0 && synced.workouts === 0) return { sent: 0 };

	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
		columns: { notificationSettings: true }
	});
	const settings = (user?.notificationSettings ?? {}) as { workoutImports?: { enabled?: boolean } };
	if (settings.workoutImports?.enabled === false) return { sent: 0 };

	const { theme: healthTheme } = await ensureThemeForUser({
		userId,
		name: HEALTH_PARENT_THEME_NAME,
		emoji: '💪',
		description: 'Helse-mortemaet: sammenhengene på tvers av trening, ernæring, egenfrekvens, søvn og skjermtid.'
	});

	// Vekt hører til mortemaet (utfallsmålet), økter til Trening-undertemaet.
	// NB: ingen ensureHealthSubthemes her — denne kjører i cron-kontekst og skal
	// ikke ha sideeffekter utover varslingen.
	const healthDataUrl = new URL(`/tema/${healthTheme.id}`, appUrl);
	healthDataUrl.searchParams.set('tab', 'data');

	const trainingTheme = await findThemeByName(userId, 'Trening');
	const workoutUrl = new URL(`/tema/${trainingTheme?.id ?? healthTheme.id}`, appUrl);
	workoutUrl.searchParams.set('tab', 'data');

	let sent = 0;

	if (synced.workouts > 0) {
		const newWorkouts = await db.query.sensorEvents.findMany({
			where: and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'workout'),
				gte(sensorEvents.createdAt, syncStartTime)
			)
		});

		for (const workout of newWorkouts) {
			const data = workout.data as Record<string, unknown>;
			const sportType = data?.sportType as string | undefined;
			if (sportType !== 'yoga') continue;

			const duration = data?.duration as number | undefined;
			const body = duration ? `${Math.round(duration / 60)} min yoga` : 'Yoga registrert';

			const delivery = await PushDeliveryService.deliverToUser({
				userId,
				payload: {
					title: 'Yoga registrert',
					body,
					url: workoutUrl.toString(),
					tag: `yoga-${workout.id}`
				},
				onGone: 'disable'
			});
			if (delivery.sent > 0) sent++;
		}
	}

	if (synced.weight > 0) {
		const newWeights = await db.query.sensorEvents.findMany({
			where: and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'weight'),
				gte(sensorEvents.createdAt, syncStartTime)
			),
			orderBy: (se, { desc }) => [desc(se.timestamp)],
			limit: 1
		});

		if (newWeights.length > 0) {
			const data = newWeights[0].data as Record<string, unknown>;
			const weight = typeof data?.weight === 'number' ? data.weight : null;

			/**
			 * Krydderet — «Laveste snittvekt siden mars 2025», «August ble ned 1,2 kg».
			 *
			 * Fram til september 2026 sa varselet «Veiing registrert / 94,2 kg», altså
			 * tallet brukeren nettopp hadde lest av på vekta og ikke noe mer. Historikken
			 * som kunne sagt hva tallet BETYDDE lå ferdig regnet i milepælsmotoren.
			 *
			 * Feiler oppslaget, faller vi tilbake på den gamle teksten: et varsel om at
			 * veiingen kom fram er fortsatt verdt å sende.
			 */
			const copy = await computeWeightPush({ userId, latestKg: weight }).catch((err) => {
				console.error(
					`[withings-sync] vekt-krydder feilet user=${userId}: ${err instanceof Error ? err.message : String(err)}`
				);
				return null;
			});

			const weightChatUrl = new URL('/samtaler', appUrl);
			weightChatUrl.searchParams.set('context', 'weight');

			const delivery = await PushDeliveryService.deliverToUser({
				userId,
				payload: {
					title: copy?.title ?? 'Veiing registrert',
					body: copy?.body ?? (weight !== null ? `${weight.toFixed(1)} kg` : 'Ny veiing registrert'),
					url: weightChatUrl.toString(),
					tag: `weight-${newWeights[0].id}`
				},
				onGone: 'disable'
			});
			if (delivery.sent > 0) sent++;
		}
	}

	return { sent };
}
