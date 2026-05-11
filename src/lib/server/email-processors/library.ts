import { db } from '$lib/db';
import { checklists, checklistItems } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import type { InboundEmailPayload } from './shared';

const NORWEGIAN_MONTHS: Record<string, number> = {
	januar: 1, jan: 1,
	februar: 2, feb: 2,
	mars: 3, mar: 3,
	april: 4, apr: 4,
	mai: 5,
	juni: 6, jun: 6,
	juli: 7, jul: 7,
	august: 8, aug: 8,
	september: 9, sep: 9, sept: 9,
	oktober: 10, okt: 10,
	november: 11, nov: 11,
	desember: 12, des: 12
};

function findDueDate(text: string): Date | null {
	const numeric = text.match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})\b/);
	if (numeric) {
		const day = parseInt(numeric[1], 10);
		const month = parseInt(numeric[2], 10);
		let year = parseInt(numeric[3], 10);
		if (year < 100) year += 2000;
		if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
			return new Date(Date.UTC(year, month - 1, day));
		}
	}

	const named = text.toLowerCase().match(/\b(\d{1,2})\.?\s+([a-zæøå]+)\.?(?:\s+(\d{2,4}))?\b/);
	if (named) {
		const day = parseInt(named[1], 10);
		const month = NORWEGIAN_MONTHS[named[2]];
		let year = named[3] ? parseInt(named[3], 10) : new Date().getUTCFullYear();
		if (year < 100) year += 2000;
		if (month && day >= 1 && day <= 31) {
			const candidate = new Date(Date.UTC(year, month - 1, day));
			if (!named[3] && candidate.getTime() < Date.now() - 7 * 24 * 60 * 60 * 1000) {
				candidate.setUTCFullYear(year + 1);
			}
			return candidate;
		}
	}

	return null;
}

function extractBookTitle(subject: string, body: string): string | null {
	const patterns = [
		/(?:tittel|bok|lånt|tittelen|forfatter\/tittel)\s*:\s*(.+)/i,
		/lever[a-zæøå]*\s+(?:tilbake\s+)?["«](.+?)["»]/i,
		/["«]([^"»]{3,80})["»]/
	];

	const haystack = `${subject}\n${body}`;
	for (const re of patterns) {
		const m = haystack.match(re);
		if (m && m[1]) {
			const title = m[1].trim().split('\n')[0].trim();
			if (title.length >= 2 && title.length <= 200) return title;
		}
	}

	return null;
}

async function findOrCreateLibraryChecklist(userId: string) {
	const existing = await db.query.checklists.findFirst({
		where: and(
			eq(checklists.userId, userId),
			eq(checklists.context, 'bibliotek')
		)
	});
	if (existing) return existing;

	const [created] = await db.insert(checklists).values({
		userId,
		title: 'Bibliotek-bøker',
		emoji: '📚',
		context: 'bibliotek'
	}).returning();

	return created;
}

export async function processLibraryEmail(userId: string, payload: InboundEmailPayload) {
	const subject = payload.Subject ?? '';
	const body = payload.TextBody ?? '';

	const dueDate = findDueDate(body) ?? findDueDate(subject);
	if (!dueDate) {
		return { skipped: true, reason: 'no_due_date' };
	}

	const title = extractBookTitle(subject, body);
	const text = title ? `Lever bok: ${title}` : `Lever bok fra biblioteket (${subject})`;

	const checklist = await findOrCreateLibraryChecklist(userId);

	const gmailMessageId = payload.GmailMessageId;
	if (gmailMessageId) {
		const existing = await db.query.checklistItems.findFirst({
			where: and(
				eq(checklistItems.userId, userId),
				eq(checklistItems.checklistId, checklist.id),
				sql`metadata->>'gmailMessageId' = ${gmailMessageId}`
			)
		});
		if (existing) {
			return { skipped: true, reason: 'already_imported' };
		}
	}

	const dueDateStr = dueDate.toISOString().slice(0, 10);

	await db.insert(checklistItems).values({
		checklistId: checklist.id,
		userId,
		text,
		endDate: dueDateStr,
		metadata: {
			source: 'email_inbound',
			label: payload.Label,
			gmailMessageId,
			from: payload.From
		}
	});

	return { success: true, imported: 1 };
}
