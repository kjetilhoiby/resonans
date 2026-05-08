import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { verifyEmailWebhookToken } from '$lib/server/email/auth';
import { routeEmail } from '$lib/server/email/router';
import type { EmailEnvelope } from '$lib/server/email/types';

export const config = { maxDuration: 30 };

interface InboundPayload {
	gmailMessageId?: string;
	gmailThreadId?: string;
	internalDate?: number | string;
	from?: string;
	to?: string;
	subject?: string;
	bodyText?: string;
	label?: string;
	attachments?: Array<{ name?: string; contentType?: string; base64?: string; size?: number }>;
}

function extractEmailAddress(raw: string): string {
	const trimmed = raw.trim().toLowerCase();
	const angle = trimmed.match(/<([^>]+)>/);
	if (angle) return angle[1].trim();
	const noSpace = trimmed.match(/^(\S+@\S+)$/);
	if (noSpace) return noSpace[1];
	return trimmed;
}

export const POST: RequestHandler = async ({ request, url }) => {
	const token = url.searchParams.get('token');
	if (!verifyEmailWebhookToken(token)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let payload: InboundPayload;
	try {
		payload = (await request.json()) as InboundPayload;
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const label = payload.label?.trim();
	if (!label) {
		return json({ error: 'Missing label' }, { status: 400 });
	}

	const handler = routeEmail(label);
	if (!handler) {
		return json({ skipped: true, reason: 'no_handler_for_label', label });
	}

	const recipient = (payload.to ?? '').trim();
	if (!recipient) {
		return json({ error: 'Missing recipient' }, { status: 400 });
	}
	const recipientEmail = extractEmailAddress(recipient);

	const user = await db.query.users.findFirst({
		where: eq(users.email, recipientEmail)
	});
	if (!user) {
		// 200 forhindrer retry — mottakeradressen er ikke en kjent bruker.
		return json({ skipped: true, reason: 'unknown_recipient' });
	}

	const internalDate = payload.internalDate
		? new Date(typeof payload.internalDate === 'string' ? parseInt(payload.internalDate, 10) : payload.internalDate)
		: new Date();

	const envelope: EmailEnvelope = {
		userId: user.id,
		gmailMessageId: payload.gmailMessageId ?? '',
		gmailThreadId: payload.gmailThreadId ?? '',
		internalDate,
		from: (payload.from ?? '').trim(),
		to: recipientEmail,
		subject: payload.subject ?? '',
		bodyText: payload.bodyText ?? '',
		label,
		attachments: (payload.attachments ?? [])
			.filter((a) => a.name && a.base64)
			.map((a) => ({
				name: a.name!,
				contentType: a.contentType ?? 'application/octet-stream',
				base64: a.base64!,
				size: a.size
			}))
	};

	try {
		const result = await handler.handle(envelope);
		return json({ success: true, label, ...result });
	} catch (error) {
		console.error('[email-inbound] handler failed:', label, error);
		return json({ error: 'Handler failed', label }, { status: 500 });
	}
};
