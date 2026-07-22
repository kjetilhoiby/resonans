import type { projectContacts } from '$lib/db/schema';

export type ContactStatus = 'todo' | 'venter' | 'ferdig';

export const CONTACT_STATUSES: ContactStatus[] = ['todo', 'venter', 'ferdig'];

export function isContactStatus(value: unknown): value is ContactStatus {
	return typeof value === 'string' && (CONTACT_STATUSES as string[]).includes(value);
}

export interface MappedContact {
	id: string;
	name: string;
	role: string | null;
	phone: string | null;
	email: string | null;
	status: ContactStatus;
	notes: string | null;
	followUpAt: string | null;
	lastContactedAt: string | null;
	sortOrder: number;
	createdAt: string;
}

export function mapContact(row: typeof projectContacts.$inferSelect): MappedContact {
	return {
		id: row.id,
		name: row.name,
		role: row.role,
		phone: row.phone,
		email: row.email,
		status: (isContactStatus(row.status) ? row.status : 'todo'),
		notes: row.notes,
		followUpAt: row.followUpAt,
		lastContactedAt: row.lastContactedAt ? row.lastContactedAt.toISOString() : null,
		sortOrder: row.sortOrder,
		createdAt: (row.createdAt as Date).toISOString()
	};
}

/** Normaliser en ISO-dato ('YYYY-MM-DD') eller returner null. */
export function normalizeIsoDate(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

/**
 * En kontakt er «klar for purring» når den har en oppfølgingsdato som er forfalt
 * (<= i dag) og statusen ikke er 'ferdig'. Ren funksjon — testes uten DB.
 */
export function isContactDueForFollowUp(
	contact: Pick<MappedContact, 'status' | 'followUpAt'>,
	todayIso: string
): boolean {
	if (contact.status === 'ferdig') return false;
	if (!contact.followUpAt) return false;
	return contact.followUpAt <= todayIso;
}

/** Filtrer ut kontaktene som skal purres i dag. */
export function contactsDueForFollowUp<T extends Pick<MappedContact, 'status' | 'followUpAt'>>(
	contacts: T[],
	todayIso: string
): T[] {
	return contacts.filter((c) => isContactDueForFollowUp(c, todayIso));
}
