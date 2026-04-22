import { db } from '$lib/db';
import { users, webPushSubscriptions } from '$lib/db/schema';
import {
	buildWorkoutImportedMessage,
	sendGoogleChatMessage,
	type WorkoutImportedMessageData
} from '$lib/server/google-chat';
import { ensureThemeForUser } from '$lib/server/themes';
import {
	buildWorkoutChatPrompt,
	type WorkoutContextSummary
} from '$lib/server/workout-context';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import { eq } from 'drizzle-orm';

function buildWorkoutChatUrl(appUrl: string, themeId: string, workout: WorkoutContextSummary) {
	const url = new URL(`/tema/${themeId}`, appUrl);
	url.searchParams.set('tab', 'chat');
	url.searchParams.set('workout', workout.id);
	url.searchParams.set('prompt', buildWorkoutChatPrompt(workout));
	return url.toString();
}

function buildWorkoutHealthUrl(appUrl: string, themeId: string, workout: WorkoutContextSummary) {
	const url = new URL(`/tema/${themeId}`, appUrl);
	url.searchParams.set('tab', 'data');
	url.searchParams.set('workout', workout.id);
	return url.toString();
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

	const { theme: healthTheme } = await ensureThemeForUser({
		userId,
		name: 'Helse',
		emoji: '💪',
		description: 'Helse, trening, søvn og restitusjon samlet i ett tema.'
	});

	let sent = 0;

	for (const workout of workouts) {
		const activityUrl = new URL(`/aktivitet/${workout.id}`, appUrl).toString();
		const workoutChatUrl = buildWorkoutChatUrl(appUrl, healthTheme.id, workout);
		let pushDelivered = false;

		// Web push (primary channel)
		const distanceText = workout.distanceKm != null ? ` · ${workout.distanceKm.toFixed(2)} km` : '';
		const durationText = workout.durationSeconds != null
			? ` · ${Math.round(workout.durationSeconds / 60)} min`
			: '';
		const delivery = await PushDeliveryService.deliverToUser({
			userId,
			payload: {
				title: `${workout.title} importert`,
				body: `${distanceText}${durationText}`.replace(/^ · /, ''),
				url: workoutChatUrl,
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
				healthChatUrl: buildWorkoutChatUrl(appUrl, healthTheme.id, workout),
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