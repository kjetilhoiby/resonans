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
import { sendWebPush, isWebPushConfigured } from '$lib/server/web-push';
import { and, eq } from 'drizzle-orm';

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

	// Hent web push-abonnementer
	const pushSubs = isWebPushConfigured()
		? await db.query.webPushSubscriptions.findMany({
				where: and(
					eq(webPushSubscriptions.userId, userId),
					eq(webPushSubscriptions.disabled, false)
				)
			})
		: [];

	let sent = 0;

	for (const workout of workouts) {
		const activityUrl = new URL(`/health/activity/${workout.id}`, appUrl).toString();

		// Google Chat
		if (user?.googleChatWebhook) {
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

		// Web push
		if (pushSubs.length > 0) {
			const distanceText = workout.distanceKm != null ? ` · ${workout.distanceKm.toFixed(2)} km` : '';
			const durationText = workout.durationSeconds != null
				? ` · ${Math.round(workout.durationSeconds / 60)} min`
				: '';

			for (const sub of pushSubs) {
				const result = await sendWebPush(
					{ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
					{
						title: `${workout.title} importert`,
						body: `${distanceText}${durationText}`.replace(/^ · /, ''),
						url: activityUrl,
						tag: `workout-${workout.id}`
					}
				);

				if (!result.ok) {
					const gone = result.statusCode === 400 || result.statusCode === 404 || result.statusCode === 410;
					if (gone) {
						await db.update(webPushSubscriptions)
							.set({ disabled: true, updatedAt: new Date() })
							.where(eq(webPushSubscriptions.id, sub.id));
					}
				}
			}
		}
	}

	return { attempted: workouts.length, sent };
}