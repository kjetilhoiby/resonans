import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

export interface InboundEmailPayload {
	UserEmail: string;
	From: string;
	Subject?: string;
	TextBody?: string;
	HtmlBody?: string;
	Label?: string;
	Attachments?: Array<{
		Name: string;
		Content: string; // base64
		ContentType: string;
		ContentLength: number;
	}>;
	GmailMessageId?: string;
	GmailDate?: string;
}

/** Strip HTML til ren tekst — delt av prosessorene som leser HtmlBody. */
export function stripHtml(html: string): string {
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

export async function findOrCreateEmailSensor(userId: string, type: string) {
	const existing = await db.query.sensors.findFirst({
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, 'email'),
			eq(sensors.type, type)
		)
	});
	if (existing) return existing;

	const [created] = await db.insert(sensors).values({
		userId,
		provider: 'email',
		type,
		name: `E-post: ${type.replace(/_/g, ' ')}`,
		isActive: true
	}).returning();

	return created;
}
