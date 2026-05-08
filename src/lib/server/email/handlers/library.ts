import { db } from '$lib/db';
import { checklists, checklistItems } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import type { EmailEnvelope, EmailHandler, EmailHandlerResult } from '../types';

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
	// dd.mm.yyyy or dd/mm/yyyy or dd-mm-yyyy
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

	// "12. mars 2026" or "12 mars 2026" or "12. mar"
	const named = text.toLowerCase().match(/\b(\d{1,2})\.?\s+([a-zæøå]+)\.?(?:\s+(\d{2,4}))?\b/);
	if (named) {
		const day = parseInt(named[1], 10);
		const month = NORWEGIAN_MONTHS[named[2]];
		let year = named[3] ? parseInt(named[3], 10) : new Date().getUTCFullYear();
		if (year < 100) year += 2000;
		if (month && day >= 1 && day <= 31) {
			const candidate = new Date(Date.UTC(year, month - 1, day));
			// If implicit year and the date is in the past, assume next year
			if (!named[3] && candidate.getTime() < Date.now() - 7 * 24 * 60 * 60 * 1000) {
				candidate.setUTCFullYear(year + 1);
			}
			return candidate;
		}
	}

	return null;
}

function extractBookTitle(subject: string, body: string): string | null {
	// Try patterns like "Tittel: ...", "Bok: ...", "Lånt bok: ..." etc.
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

export const libraryHandler: EmailHandler = {
	label: 'Resonans/Bibliotek',

	async handle(envelope: EmailEnvelope): Promise<EmailHandlerResult> {
		const dueDate = findDueDate(envelope.bodyText) ?? findDueDate(envelope.subject);
		if (!dueDate) {
			return { imported: 0, failed: 0, notes: ['no_due_date'] };
		}

		const title = extractBookTitle(envelope.subject, envelope.bodyText);
		const text = title ? `Lever bok: ${title}` : `Lever bok fra biblioteket (${envelope.subject})`;

		const checklist = await findOrCreateLibraryChecklist(envelope.userId);

		// Idempotens: hopp over hvis vi allerede har et item for samme gmailMessageId
		const existing = await db.query.checklistItems.findFirst({
			where: and(
				eq(checklistItems.userId, envelope.userId),
				eq(checklistItems.checklistId, checklist.id),
				sql`metadata->>'gmailMessageId' = ${envelope.gmailMessageId}`
			)
		});
		if (existing) {
			return { imported: 0, failed: 0, notes: ['already_imported'] };
		}

		const dueDateStr = dueDate.toISOString().slice(0, 10);

		await db.insert(checklistItems).values({
			checklistId: checklist.id,
			userId: envelope.userId,
			text,
			endDate: dueDateStr,
			metadata: {
				source: 'email_inbound',
				label: envelope.label,
				gmailMessageId: envelope.gmailMessageId,
				gmailThreadId: envelope.gmailThreadId,
				from: envelope.from
			}
		});

		return { imported: 1, failed: 0 };
	}
};
