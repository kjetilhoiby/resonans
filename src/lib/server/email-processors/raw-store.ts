import { SensorEventService } from '$lib/server/services/sensor-event-service';
import type { InboundEmailPayload } from './shared';
import type { emailRules } from '$lib/db/schema';

type EmailRule = typeof emailRules.$inferSelect;

function stripHtml(html: string): string {
	return html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

export async function processRawStoreEmail(
	userId: string,
	sensor: { id: string },
	payload: InboundEmailPayload,
	rule: EmailRule
) {
	const textBody = payload.TextBody || (payload.HtmlBody ? stripHtml(payload.HtmlBody) : '');

	const { event } = await SensorEventService.write({
		userId,
		sensorId: sensor.id,
		eventType: rule.eventType,
		dataType: rule.dataType,
		timestamp: new Date(),
		data: {
			emailSubject: payload.Subject,
			emailFrom: payload.From,
			textBody: textBody.slice(0, 20000),
			hasHtml: !!payload.HtmlBody,
			attachmentCount: payload.Attachments?.length ?? 0,
			attachmentNames: payload.Attachments?.map((a: { Name: string }) => a.Name) ?? [],
		},
		metadata: {
			source: 'email_inbound',
			ruleName: rule.name,
			ruleId: rule.id,
			processingType: 'raw_store',
		},
		source: 'email_inbound'
	}, { conflictMode: 'ignore' });

	return { success: true, eventId: event?.id };
}
