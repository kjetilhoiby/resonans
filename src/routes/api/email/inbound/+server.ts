import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { emailRules, sensors, users } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { processWorkoutEmail } from '$lib/server/email-processors/workout';
import { processAiExtractionEmail } from '$lib/server/email-processors/ai-extraction';
import { processRawStoreEmail } from '$lib/server/email-processors/raw-store';
import { processLibraryEmail } from '$lib/server/email-processors/library';
import { findOrCreateEmailSensor, type InboundEmailPayload } from '$lib/server/email-processors/shared';

export const config = { maxDuration: 60 };

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}

function extractRecipientEmail(raw: string): string {
	const trimmed = raw.trim().toLowerCase();
	const angle = trimmed.match(/<([^>]+)>/);
	if (angle) return angle[1].trim();
	return trimmed;
}

function matchesPattern(value: string, pattern: string): boolean {
	if (!pattern) return true;
	const lower = value.toLowerCase();
	const p = pattern.toLowerCase();
	if (p.startsWith('*') && p.endsWith('*')) {
		return lower.includes(p.slice(1, -1));
	}
	if (p.startsWith('*')) {
		return lower.endsWith(p.slice(1));
	}
	if (p.endsWith('*')) {
		return lower.startsWith(p.slice(0, -1));
	}
	return lower === p || lower.includes(p);
}

type RuleMatch = typeof emailRules.$inferSelect;

async function executeRule(userId: string, rule: RuleMatch, payload: InboundEmailPayload) {
	switch (rule.processingType) {
		case 'workout_files': {
			const sensor = await findOrCreateEmailSensor(userId, 'workout_files');
			const result = await processWorkoutEmail(userId, sensor, payload);
			await db.update(sensors).set({ lastSync: new Date(), updatedAt: new Date() }).where(eq(sensors.id, sensor.id));
			return result;
		}
		case 'library': {
			return await processLibraryEmail(userId, payload, rule.themeId);
		}
		case 'ai_extraction': {
			const sensor = await findOrCreateEmailSensor(userId, 'email_ai_extraction');
			const result = await processAiExtractionEmail(userId, sensor, payload, rule);
			await db.update(sensors).set({ lastSync: new Date(), updatedAt: new Date() }).where(eq(sensors.id, sensor.id));
			return result;
		}
		case 'raw_store':
		default: {
			const sensor = await findOrCreateEmailSensor(userId, 'email_raw_store');
			const result = await processRawStoreEmail(userId, sensor, payload, rule);
			await db.update(sensors).set({ lastSync: new Date(), updatedAt: new Date() }).where(eq(sensors.id, sensor.id));
			return result;
		}
	}
}

export const POST: RequestHandler = async ({ request, url }) => {
	const token = url.searchParams.get('token');
	const secret = env.EMAIL_WEBHOOK_SECRET;

	if (!secret || !token || !timingSafeEqual(token, secret)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let raw: Record<string, any>;
	try {
		raw = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const payload: InboundEmailPayload = {
		UserEmail: raw.UserEmail ?? raw.to ?? '',
		From: raw.From ?? raw.from ?? '',
		Subject: raw.Subject ?? raw.subject,
		TextBody: raw.TextBody ?? raw.bodyText,
		HtmlBody: raw.HtmlBody ?? raw.htmlBody,
		Label: raw.Label ?? raw.label,
		GmailMessageId: raw.GmailMessageId ?? raw.gmailMessageId,
		GmailDate: raw.GmailDate ?? raw.gmailDate ?? (raw.internalDate ? String(raw.internalDate) : undefined),
		Attachments: (raw.Attachments ?? raw.attachments ?? []).map((a: any) => ({
			Name: a.Name ?? a.name ?? '',
			Content: a.Content ?? a.base64 ?? '',
			ContentType: a.ContentType ?? a.contentType ?? 'application/octet-stream',
			ContentLength: a.ContentLength ?? a.size ?? 0,
		})),
	};

	const userEmail = extractRecipientEmail(payload.UserEmail);

	let user = userEmail
		? await db.query.users.findFirst({ where: eq(users.email, userEmail) })
		: null;

	if (!user) {
		const label = (payload.Label ?? '').toLowerCase().trim();
		if (label) {
			const rulesWithUser = await db
				.select({ userId: emailRules.userId })
				.from(emailRules)
				.where(eq(emailRules.isActive, true))
				.groupBy(emailRules.userId);
			for (const { userId } of rulesWithUser) {
				const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
				if (u) { user = u; break; }
			}
		}
	}

	if (!user) {
		return json({ skipped: true, reason: 'unknown_user', hint: userEmail || 'no email in payload' });
	}

	const label = (payload.Label ?? '').toLowerCase().trim();
	const subject = payload.Subject ?? '';
	const fromField = payload.From ?? '';

	// 1) Match user-defined rules (label, sender, subject)
	const rules = await db.query.emailRules.findMany({
		where: and(
			eq(emailRules.userId, user.id),
			eq(emailRules.isActive, true)
		)
	});

	const matchedRules = rules.filter(rule => {
		const labelOk = !rule.labelPattern || (label && matchesPattern(label, rule.labelPattern));
		const senderOk = !rule.senderPattern || matchesPattern(fromField, rule.senderPattern);
		const subjectOk = !rule.subjectPattern || matchesPattern(subject, rule.subjectPattern);
		// At least one pattern must be set for a rule to match
		const hasPatterns = rule.labelPattern || rule.senderPattern || rule.subjectPattern;
		return hasPatterns && labelOk && senderOk && subjectOk;
	});

	if (matchedRules.length > 0) {
		const results: Array<{ ruleId: string; ruleName: string; success: boolean; detail?: any }> = [];

		for (const rule of matchedRules) {
			try {
				const result = await executeRule(user.id, rule, payload);

				await db.update(emailRules).set({
					lastMatchedAt: new Date(),
					matchCount: (rule.matchCount ?? 0) + 1,
					updatedAt: new Date(),
				}).where(eq(emailRules.id, rule.id));

				results.push({ ruleId: rule.id, ruleName: rule.name, success: true, detail: result });
			} catch (error) {
				console.error(`[email-inbound] rule "${rule.name}" failed:`, error);
				results.push({ ruleId: rule.id, ruleName: rule.name, success: false, detail: String(error) });
			}
		}

		return json({ success: true, rulesMatched: results.length, results });
	}

	// 2) Last resort: workout attachments without label or rule
	const hasWorkoutAttachments = (payload.Attachments ?? []).some(
		a => a.Name?.toLowerCase().endsWith('.gpx') || a.Name?.toLowerCase().endsWith('.tcx')
	);
	if (hasWorkoutAttachments) {
		const sensor = await findOrCreateEmailSensor(user.id, 'workout_files');
		const result = await processWorkoutEmail(user.id, sensor, payload);
		return json({ success: true, handler: 'workout_fallback', ...result });
	}

	return json({ skipped: true, reason: 'no_matching_rules', label: label || undefined });
};
