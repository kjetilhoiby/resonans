import { db } from '$lib/db';
import { emailInboundLog, emailRules, sensors, users, type EmailInboundRuleResult } from '$lib/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { describeErrorForStorage } from '$lib/domain/error-text';
import { processWorkoutEmail } from '$lib/server/email-processors/workout';
import { processAiExtractionEmail } from '$lib/server/email-processors/ai-extraction';
import { processRawStoreEmail } from '$lib/server/email-processors/raw-store';
import { processLibraryEmail } from '$lib/server/email-processors/library';
import { processSchoolPlanEmail } from '$lib/server/email-processors/school-plan';
import { processOdaReceiptEmail } from '$lib/server/email-processors/oda-receipt';
import { processFindTriageEmail } from '$lib/server/email-processors/find-triage';
import { findOrCreateEmailSensor } from '$lib/server/email-processors/shared';
import {
	candidateUserEmails,
	hasWorkoutAttachments,
	isSettled,
	ruleMatches,
	type InboundEmailPayload,
	type InboundStatus
} from './inbound';

type EmailRule = typeof emailRules.$inferSelect;

/** Brukeren e-posten gjelder, eller null. Aldri en gjetning — se `candidateUserEmails`. */
export async function resolveInboundUser(payload: InboundEmailPayload) {
	const candidates = candidateUserEmails(payload);
	if (candidates.length === 0) return null;
	const rows = await db.query.users.findMany({ where: inArray(users.email, candidates) });
	// Prioritert rekkefølge: UserEmail før To.
	for (const email of candidates) {
		const hit = rows.find((u) => u.email?.toLowerCase() === email);
		if (hit) return hit;
	}
	return null;
}

async function touchSensor(sensorId: string) {
	await db.update(sensors).set({ lastSync: new Date(), updatedAt: new Date() }).where(eq(sensors.id, sensorId));
}

async function executeRule(userId: string, rule: EmailRule, payload: InboundEmailPayload, appUrl?: string) {
	switch (rule.processingType) {
		case 'workout_files': {
			const sensor = await findOrCreateEmailSensor(userId, 'workout_files');
			const result = await processWorkoutEmail(userId, sensor, payload, appUrl);
			await touchSensor(sensor.id);
			return result;
		}
		case 'library':
			return await processLibraryEmail(userId, payload);
		case 'school_plan':
			return await processSchoolPlanEmail(userId, payload, rule, appUrl);
		case 'oda_receipt':
			return await processOdaReceiptEmail(userId, payload, rule);
		case 'find_triage':
			return await processFindTriageEmail(userId, payload, rule);
		case 'ai_extraction': {
			const sensor = await findOrCreateEmailSensor(userId, 'email_ai_extraction');
			const result = await processAiExtractionEmail(userId, sensor, payload, rule);
			await touchSensor(sensor.id);
			return result;
		}
		case 'raw_store':
		default: {
			const sensor = await findOrCreateEmailSensor(userId, 'email_raw_store');
			const result = await processRawStoreEmail(userId, sensor, payload, rule);
			await touchSensor(sensor.id);
			return result;
		}
	}
}

export async function loadActiveRules(userId: string): Promise<EmailRule[]> {
	return db.query.emailRules.findMany({
		where: and(eq(emailRules.userId, userId), eq(emailRules.isActive, true))
	});
}

export function matchRules(rules: EmailRule[], payload: InboundEmailPayload): EmailRule[] {
	const input = {
		label: (payload.Label ?? '').trim(),
		from: payload.From ?? '',
		subject: payload.Subject ?? ''
	};
	return rules.filter((rule) => ruleMatches(rule, input));
}

export interface InboundOutcome {
	status: InboundStatus;
	duplicate: boolean;
	results: EmailInboundRuleResult[];
	handler?: 'rules' | 'workout_fallback';
}

function receivedAt(payload: InboundEmailPayload): Date | null {
	const ms = Number(payload.GmailDate);
	return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
}

/**
 * Kjør reglene for én e-post og bokfør utfallet.
 *
 * - En melding som alt er `processed`/`no_match` kjøres ikke igjen (`duplicate`).
 * - Ved et nytt forsøk etter `failed` hoppes regler som lyktes sist over, så en
 *   Oda-kvittering ikke legges i lageret to ganger fordi biblioteksregelen feilet.
 * - Uten Gmail-ID (testkall) bokføres ingenting.
 */
export async function processInboundEmail(
	userId: string,
	payload: InboundEmailPayload,
	appUrl?: string
): Promise<InboundOutcome> {
	const messageId = payload.GmailMessageId?.trim() || null;

	const previous = messageId
		? await db.query.emailInboundLog.findFirst({
				where: and(eq(emailInboundLog.userId, userId), eq(emailInboundLog.gmailMessageId, messageId))
			})
		: null;

	if (previous && isSettled(previous.status)) {
		return { status: previous.status as InboundStatus, duplicate: true, results: previous.rules };
	}

	const alreadySucceeded = new Map(
		(previous?.rules ?? []).filter((r) => r.success).map((r) => [r.ruleId, r] as const)
	);

	const matched = matchRules(await loadActiveRules(userId), payload);
	const results: EmailInboundRuleResult[] = [];
	let handler: InboundOutcome['handler'];

	if (matched.length > 0) {
		handler = 'rules';
		for (const rule of matched) {
			const earlier = alreadySucceeded.get(rule.id);
			if (earlier) {
				results.push(earlier);
				continue;
			}
			try {
				const detail = await executeRule(userId, rule, payload, appUrl);
				await db
					.update(emailRules)
					.set({
						lastMatchedAt: new Date(),
						matchCount: sql`${emailRules.matchCount} + 1`,
						updatedAt: new Date()
					})
					.where(eq(emailRules.id, rule.id));
				results.push({ ruleId: rule.id, ruleName: rule.name, success: true, detail });
			} catch (error) {
				console.error(`[email-inbound] regel «${rule.name}» feilet:`, error);
				results.push({
					ruleId: rule.id,
					ruleName: rule.name,
					success: false,
					detail: describeErrorForStorage(error, 500)
				});
			}
		}
	} else if (hasWorkoutAttachments(payload)) {
		// Siste utvei: GPX/TCX uten label eller regel.
		handler = 'workout_fallback';
		try {
			const sensor = await findOrCreateEmailSensor(userId, 'workout_files');
			const detail = await processWorkoutEmail(userId, sensor, payload, appUrl);
			results.push({ ruleId: 'workout_fallback', ruleName: 'Treningsfiler (uten regel)', success: true, detail });
		} catch (error) {
			console.error('[email-inbound] workout-fallback feilet:', error);
			results.push({
				ruleId: 'workout_fallback',
				ruleName: 'Treningsfiler (uten regel)',
				success: false,
				detail: describeErrorForStorage(error, 500)
			});
		}
	}

	const status: InboundStatus =
		results.length === 0 ? 'no_match' : results.every((r) => r.success) ? 'processed' : 'failed';

	if (messageId) {
		const failedText = results
			.filter((r) => !r.success)
			.map((r) => `${r.ruleName}: ${String(r.detail ?? '')}`)
			.join(' · ');
		const row = {
			gmailThreadId: payload.GmailThreadId ?? null,
			label: payload.Label ?? null,
			fromAddress: (payload.From ?? '').slice(0, 300) || null,
			subject: (payload.Subject ?? '').slice(0, 300) || null,
			receivedAt: receivedAt(payload),
			status,
			rules: results,
			error: failedText ? failedText.slice(0, 2000) : null,
			scriptVersion: payload.ScriptVersion ?? null,
			updatedAt: new Date()
		};
		await db
			.insert(emailInboundLog)
			.values({ userId, gmailMessageId: messageId, ...row })
			.onConflictDoUpdate({
				target: [emailInboundLog.userId, emailInboundLog.gmailMessageId],
				set: { ...row, attempts: sql`${emailInboundLog.attempts} + 1` }
			});
	}

	return { status, duplicate: false, results, handler };
}
