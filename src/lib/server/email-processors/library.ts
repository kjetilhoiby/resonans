import { db } from '$lib/db';
import { checklists, checklistItems } from '$lib/db/schema';
import { and, eq, ne, sql } from 'drizzle-orm';
import { loanItemText, loanKey, parseLibraryEmail, type LibraryLoan, type ParsedLibraryEmail } from '$lib/domain/library-email';
import { stripHtml, type InboundEmailPayload } from './shared';
import { addDatedItems } from './day-checklist';

/**
 * Deichman-e-post → bibliotekslista («Bibliotek-bøker») + dagslista.
 *
 * - Ett punkt per lån, nøklet på strekkoden (`metadata.libraryKey`). En fornyelse
 *   gir en ny påminnelse med ny dato: da FLYTTES punktet og dagspunktet, i stedet
 *   for at det kommer et nytt. Fram til november 2026 ble hver påminnelse et nytt
 *   punkt, og bare den første tittelen i e-posten ble lest.
 * - Purring legger boka på DAGENS liste. Purringen har ingen dato, bare «for 5
 *   dager siden», og ble derfor hoppet over helt.
 * - Hentemelding er et eget punkt («Hent: … på Bøler (nr. 13)») med hentefrist.
 *   En senere påminnelse for samme strekkode betyr at boka ble hentet, og lukker
 *   hentepunktet.
 * - Dagspunktet peker på bibliotekspunktet (`linkedChecklistItemId`), så det å
 *   krysse av på dagen krysser av i bibliotekslista også.
 *
 * Et lån som er levert får ingen e-post. Punktet lukkes når brukeren krysser av.
 */

type Family = 'return' | 'pickup';

function osloIsoDate(date: Date): string {
	return date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
}

async function findOrCreateLibraryChecklist(userId: string) {
	const existing = await db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, 'bibliotek'))
	});
	if (existing) return existing;

	const [created] = await db
		.insert(checklists)
		.values({ userId, title: 'Bibliotek-bøker', emoji: '📚', context: 'bibliotek' })
		.returning();
	return created;
}

async function findOpenLoanItem(userId: string, checklistId: string, key: string, family: Family) {
	return db.query.checklistItems.findFirst({
		where: and(
			eq(checklistItems.userId, userId),
			eq(checklistItems.checklistId, checklistId),
			eq(checklistItems.checked, false),
			sql`${checklistItems.metadata}->>'libraryKey' = ${key}`,
			sql`${checklistItems.metadata}->>'findingType' = ${family}`
		)
	});
}

/** Fjern dagspunkter som ennå ikke er krysset av, så punktet kan legges på en ny dag. */
async function removeOpenDayItems(userId: string, libraryItemId: string) {
	await db
		.delete(checklistItems)
		.where(
			and(
				eq(checklistItems.userId, userId),
				eq(checklistItems.checked, false),
				ne(checklistItems.id, libraryItemId),
				sql`${checklistItems.metadata}->>'linkedChecklistItemId' = ${libraryItemId}`
			)
		);
}

function dueDateFor(parsed: ParsedLibraryEmail, existingDue: string | null, receivedIso: string): string | null {
	if (parsed.kind === 'reminder' || parsed.kind === 'pickup') return parsed.deadline ?? existingDue;
	// Purring: fristen er passert. Behold den vi kjenner, ellers dagen purringen kom.
	return existingDue ?? receivedIso;
}

/** Dagen punktet skal stå på i dagslista, eller null når den er passert. */
function dayFor(parsed: ParsedLibraryEmail, dueDate: string | null, todayIso: string): string | null {
	if (parsed.kind === 'reminder') {
		if (!dueDate) return null;
		return dueDate >= todayIso ? dueDate : null;
	}
	if (parsed.kind === 'pickup') {
		return !dueDate || dueDate >= todayIso ? todayIso : null;
	}
	return todayIso; // purring: i dag
}

async function upsertLoan(args: {
	userId: string;
	checklistId: string;
	loan: LibraryLoan;
	parsed: ParsedLibraryEmail;
	payload: InboundEmailPayload;
	receivedIso: string;
	todayIso: string;
}): Promise<'created' | 'updated'> {
	const { userId, checklistId, loan, parsed, payload, receivedIso, todayIso } = args;
	const key = loanKey(loan);
	const family: Family = parsed.kind === 'pickup' ? 'pickup' : 'return';
	const text = loanItemText(loan, parsed);

	const existing = await findOpenLoanItem(userId, checklistId, key, family);
	const dueDate = dueDateFor(parsed, existing?.dueDate ?? null, receivedIso);

	const metadata = {
		...(existing?.metadata ?? {}),
		source: 'email_inbound',
		label: payload.Label,
		gmailMessageId: payload.GmailMessageId,
		from: payload.From,
		emailSubject: payload.Subject,
		findingType: family,
		libraryKey: key,
		libraryKind: parsed.kind,
		libraryTitle: loan.title,
		libraryAuthor: loan.author ?? undefined,
		libraryBarcode: loan.barcode ?? undefined,
		libraryFeeNok: parsed.feeNok ?? undefined,
		libraryBlocked: parsed.blocked || undefined,
		libraryPickupBranch: parsed.pickupBranch ?? undefined
	};

	let itemId: string;
	let outcome: 'created' | 'updated';
	if (existing) {
		await db
			.update(checklistItems)
			.set({ text, dueDate, endDate: dueDate, metadata })
			.where(eq(checklistItems.id, existing.id));
		itemId = existing.id;
		outcome = 'updated';
	} else {
		const [created] = await db
			.insert(checklistItems)
			.values({ checklistId, userId, text, dueDate, endDate: dueDate, metadata })
			.returning({ id: checklistItems.id });
		itemId = created.id;
		outcome = 'created';
	}

	// En påminnelse for en bok vi ventet på å hente: den er hentet.
	if (parsed.kind === 'reminder') {
		const pickup = await findOpenLoanItem(userId, checklistId, key, 'pickup');
		if (pickup) {
			await db
				.update(checklistItems)
				.set({ checked: true, checkedAt: new Date() })
				.where(eq(checklistItems.id, pickup.id));
			await removeOpenDayItems(userId, pickup.id);
		}
	}

	await removeOpenDayItems(userId, itemId);
	const day = dayFor(parsed, dueDate, todayIso);
	if (day) {
		await addDatedItems(userId, [
			{
				isoDate: day,
				text,
				dueDate: dueDate ?? undefined,
				metadata: {
					source: 'email_inbound',
					gmailMessageId: payload.GmailMessageId,
					findingType: family,
					linkedChecklistItemId: itemId
				}
			}
		]);
	}

	return outcome;
}

export async function processLibraryEmail(userId: string, payload: InboundEmailPayload) {
	const subject = payload.Subject ?? '';
	const body = payload.TextBody || (payload.HtmlBody ? stripHtml(payload.HtmlBody) : '');
	const receivedMs = Number(payload.GmailDate);
	const receivedIso = osloIsoDate(Number.isFinite(receivedMs) && receivedMs > 0 ? new Date(receivedMs) : new Date());
	const todayIso = osloIsoDate(new Date());

	const parsed = parseLibraryEmail(subject, body, receivedIso);
	if (!parsed) return { skipped: true, reason: 'not_a_loan_email' };
	if (parsed.loans.length === 0) return { skipped: true, reason: 'no_loans_found', kind: parsed.kind };

	const checklist = await findOrCreateLibraryChecklist(userId);
	let created = 0;
	let updated = 0;
	for (const loan of parsed.loans) {
		const outcome = await upsertLoan({ userId, checklistId: checklist.id, loan, parsed, payload, receivedIso, todayIso });
		if (outcome === 'created') created += 1;
		else updated += 1;
	}

	return { success: true, kind: parsed.kind, loans: parsed.loans.length, created, updated };
}
