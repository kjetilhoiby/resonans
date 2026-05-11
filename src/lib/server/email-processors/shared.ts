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
