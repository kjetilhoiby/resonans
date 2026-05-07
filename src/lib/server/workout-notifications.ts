import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import {
	buildWorkoutImportedMessage,
	sendGoogleChatMessage,
	type WorkoutImportedMessageData
} from '$lib/server/google-chat';
import { type WorkoutContextSummary } from '$lib/server/workout-context';
import { computeWorkoutNugget } from '$lib/server/workout-nuggets';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import { eq } from 'drizzle-orm';

function buildActivityUrl(appUrl: string, workoutId: string) {
	return new URL(`/aktivitet/${workoutId}`, appUrl).toString();
}

export async function notifyUserAboutImportedWorkouts(args: {
	userId: string;
	appUrl: string;
	workouts: WorkoutContextSummary[];
}) {
	const { userId, appUrl, workouts } = args;
	if (workouts.length === 0) return { attempted: 0, sent: 0 };

	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
		columns: {
			id: true,
			name: true,
			googleChatWebhook: true,
			notificationSettings: true
		}
	});

	const settings = (user?.notificationSettings ?? {}) as { workoutImports?: { enabled?: boolean } };
	if (settings.workoutImports?.enabled === false) {
		return { attempted: 0, sent: 0 };
	}

	let sent = 0;

	for (const workout of workouts) {
		const activityUrl = buildActivityUrl(appUrl, workout.id);
		let pushDelivered = false;

		const nugget = await computeWorkoutNugget(userId, workout).catch(() => null);
		const title = nugget?.headline ?? `${workout.title} importert`;

		const distanceText = workout.distanceKm != null ? `${workout.distanceKm.toFixed(2)} km` : '';
		const durationText = workout.durationSeconds != null
			? `${Math.round(workout.durationSeconds / 60)} min`
			: '';
		const stats = [distanceText, durationText].filter(Boolean).join(' · ');
		const fallbackTitle = nugget ? `${workout.title} importert` : '';
		const body = [stats, fallbackTitle].filter(Boolean).join(' — ') || 'Treningsøkt importert';

		const delivery = await PushDeliveryService.deliverToUser({
			userId,
			payload: {
				title,
				body,
				url: activityUrl,
				tag: `workout-${workout.id}`
			},
			onGone: 'disable'
		});
		pushDelivered = delivery.sent > 0;

		// Google Chat fallback (legacy/pre-PWA channel)
		if (!pushDelivered && user?.googleChatWebhook) {
			const message: WorkoutImportedMessageData = {
				appUrl,
				workoutTitle: workout.title,
				workoutTimestamp: workout.timestamp,
				distanceKm: workout.distanceKm,
				durationSeconds: workout.durationSeconds,
				paceSecondsPerKm: workout.paceSecondsPerKm,
				elevationMeters: workout.elevationMeters,
				avgHeartRate: workout.avgHeartRate,
				maxHeartRate: workout.maxHeartRate,
				sourceName: workout.sourceName,
				healthChatUrl: activityUrl,
				healthDataUrl: activityUrl
			};
			const delivered = await sendGoogleChatMessage(
				user.googleChatWebhook,
				buildWorkoutImportedMessage(message)
			);
			if (delivered) sent += 1;
		}

		if (pushDelivered) sent += 1;
	}

	return { attempted: workouts.length, sent };
}