import { db } from '$lib/db';
import { users, sensorEvents } from '$lib/db/schema';
import { eq, and, gte } from 'drizzle-orm';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import { ensureThemeForUser } from '$lib/server/themes';

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
		name: 'Helse',
		emoji: '💪',
		description: 'Helse, trening, søvn og restitusjon samlet i ett tema.'
	});

	const healthDataUrl = new URL(`/tema/${healthTheme.id}`, appUrl);
	healthDataUrl.searchParams.set('tab', 'data');

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
					url: healthDataUrl.toString(),
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
			const weight = data?.weight as number | undefined;
			const body = weight ? `${weight.toFixed(1)} kg` : 'Ny veiing registrert';

			const weightChatUrl = new URL('/samtaler', appUrl);
			weightChatUrl.searchParams.set('context', 'weight');

			const delivery = await PushDeliveryService.deliverToUser({
				userId,
				payload: {
					title: 'Veiing registrert',
					body,
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
