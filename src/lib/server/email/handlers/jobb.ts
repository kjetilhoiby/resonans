import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import type { EmailEnvelope, EmailHandler, EmailHandlerResult } from '../types';

export const jobbHandler: EmailHandler = {
	label: 'jobb',
	async handle(envelope: EmailEnvelope): Promise<EmailHandlerResult> {
		await SensorEventService.write(
			{
				userId: envelope.userId,
				sensorId: `jobb-email-${envelope.userId}`,
				eventType: 'notification',
				dataType: 'jobb_email',
				timestamp: envelope.internalDate,
				data: {
					from: envelope.from,
					subject: envelope.subject,
					bodyText: envelope.bodyText.slice(0, 2000),
					gmailMessageId: envelope.gmailMessageId,
					gmailThreadId: envelope.gmailThreadId,
					attachmentCount: envelope.attachments.length
				},
				source: 'email_webhook',
				dedupeKey: envelope.gmailMessageId || undefined
			},
			{ conflictMode: 'ignore' }
		);

		return { imported: 1, failed: 0 };
	}
};
