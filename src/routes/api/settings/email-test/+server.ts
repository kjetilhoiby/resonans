import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { routeEmail } from '$lib/server/email/router';
import type { EmailEnvelope } from '$lib/server/email/types';

interface TestPayload {
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

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const user = await db.query.users.findFirst({
		where: eq(users.id, locals.userId)
	});
	if (!user) {
		return json({ error: 'User not found' }, { status: 404 });
	}

	let payload: TestPayload;
	try {
		payload = (await request.json()) as TestPayload;
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

	const internalDate = payload.internalDate
		? new Date(typeof payload.internalDate === 'string' ? parseInt(payload.internalDate, 10) : payload.internalDate)
		: new Date();

	const envelope: EmailEnvelope = {
		userId: user.id,
		gmailMessageId: payload.gmailMessageId ?? `test-${Date.now()}`,
		gmailThreadId: payload.gmailThreadId ?? `test-thread-${Date.now()}`,
		internalDate,
		from: payload.from ?? 'test@example.com',
		to: payload.to ?? user.email ?? '',
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
		console.error('[email-inbound/test] handler failed:', label, error);
		return json({ error: 'Handler failed', detail: String(error) }, { status: 500 });
	}
};
