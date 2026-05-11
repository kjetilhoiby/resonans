import { parseWorkoutFile } from '$lib/server/integrations/dropbox-sync';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { getWorkoutContextForUser } from '$lib/server/workout-context';
import { notifyUserAboutImportedWorkouts } from '$lib/server/workout-notifications';
import { buildWorkoutData } from '$lib/server/email/handlers/workout';
import type { InboundEmailPayload } from './shared';

export async function processWorkoutEmail(
	userId: string,
	sensor: { id: string },
	payload: InboundEmailPayload,
	appUrl?: string
) {
	const attachments = (payload.Attachments ?? []).filter(
		(a) => a.Name?.toLowerCase().endsWith('.gpx') || a.Name?.toLowerCase().endsWith('.tcx')
	);

	if (attachments.length === 0) {
		return { skipped: true, reason: 'no_workout_attachments' };
	}

	let imported = 0;
	let failed = 0;
	const importedWorkoutIds: string[] = [];

	for (const attachment of attachments) {
		try {
			const content = atob(attachment.Content);
			const parsed = parseWorkoutFile(attachment.Name, content);
			if (!parsed) { failed += 1; continue; }

			const { data, metadata } = buildWorkoutData(parsed);

			const { event: inserted } = await SensorEventService.write({
				userId,
				sensorId: sensor.id,
				eventType: 'activity',
				dataType: 'workout',
				timestamp: parsed.startTime,
				data,
				metadata: {
					...metadata,
					sourceName: attachment.Name,
					gmailMessageId: payload.GmailMessageId
				},
				source: 'email_inbound'
			}, { conflictMode: 'upsert_sensor_datatype_timestamp' });

			if (inserted?.id) importedWorkoutIds.push(inserted.id);
			imported += 1;
		} catch (error) {
			failed += 1;
			console.error('[email-inbound] workout import failed:', attachment.Name, error);
		}
	}

	if (importedWorkoutIds.length > 0 && appUrl) {
		const importedWorkouts = (
			await Promise.all(importedWorkoutIds.map((id) => getWorkoutContextForUser(userId, id)))
		).filter((w): w is NonNullable<typeof w> => w !== null);

		await notifyUserAboutImportedWorkouts({ userId, appUrl, workouts: importedWorkouts })
			.catch((err) => console.error('[email-inbound] notification failed:', err));
	}

	return { success: true, imported, failed };
}
