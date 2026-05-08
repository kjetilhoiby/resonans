import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { verifyEmailWebhookToken } from '$lib/server/email/auth';
import { workoutHandler } from '$lib/server/email/handlers/workout';
import type { EmailEnvelope } from '$lib/server/email/types';

// Bakoverkompatibel shim for opprinnelig Postmark-payload.
// Det nye, generelle endepunktet er /api/email-inbound. Slettes når Apps
// Script er pekt om dit.
//
// Postmark inbound webhook payload (forenklet):
//   { From, FromFull?: { Email }, Subject, Attachments: [{ Name, Content (base64), ContentType, ContentLength }] }

interface PostmarkAttachment {
	Name: string;
	Content: string;
	ContentType: string;
	ContentLength: number;
}

interface PostmarkInboundPayload {
	From: string;
	FromFull?: { Email: string; Name?: string };
	Subject?: string;
	Attachments?: PostmarkAttachment[];
}

export const config = { maxDuration: 30 };

export const POST: RequestHandler = async ({ request, url }) => {
	const token = url.searchParams.get('token');
	if (!verifyEmailWebhookToken(token)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let payload: PostmarkInboundPayload;
	try {
		payload = (await request.json()) as PostmarkInboundPayload;
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const senderEmail = (payload.FromFull?.Email ?? payload.From ?? '').toLowerCase().trim();
	if (!senderEmail) {
		return json({ error: 'Missing sender email' }, { status: 400 });
	}

	const emailMatch = senderEmail.match(/<([^>]+)>/) ?? senderEmail.match(/^([^\s]+)$/);
	const cleanEmail = emailMatch ? emailMatch[1] : senderEmail;

	const user = await db.query.users.findFirst({
		where: eq(users.email, cleanEmail)
	});
	if (!user) {
		return json({ skipped: true, reason: 'unknown_sender' });
	}

	const envelope: EmailEnvelope = {
		userId: user.id,
		gmailMessageId: '',
		gmailThreadId: '',
		internalDate: new Date(),
		from: senderEmail,
		to: cleanEmail,
		subject: payload.Subject ?? '',
		bodyText: '',
		label: workoutHandler.label,
		attachments: (payload.Attachments ?? []).map((a) => ({
			name: a.Name,
			contentType: a.ContentType,
			base64: a.Content,
			size: a.ContentLength
		}))
	};

	try {
		const result = await workoutHandler.handle(envelope);
		return json({ success: true, ...result });
	} catch (error) {
		console.error('[workouts/email-inbound] handler failed:', error);
		return json({ error: 'Handler failed' }, { status: 500 });
	}
};
