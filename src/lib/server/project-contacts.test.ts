import { describe, it, expect } from 'vitest';
import {
	isContactStatus,
	isContactDueForFollowUp,
	contactsDueForFollowUp,
	normalizeIsoDate
} from './project-contacts';

describe('project-contacts', () => {
	describe('isContactStatus', () => {
		it('godtar gyldige statuser', () => {
			expect(isContactStatus('todo')).toBe(true);
			expect(isContactStatus('venter')).toBe(true);
			expect(isContactStatus('ferdig')).toBe(true);
		});
		it('avviser ugyldige verdier', () => {
			expect(isContactStatus('done')).toBe(false);
			expect(isContactStatus(null)).toBe(false);
			expect(isContactStatus(undefined)).toBe(false);
		});
	});

	describe('normalizeIsoDate', () => {
		it('godtar YYYY-MM-DD', () => {
			expect(normalizeIsoDate('2026-07-20')).toBe('2026-07-20');
			expect(normalizeIsoDate(' 2026-07-20 ')).toBe('2026-07-20');
		});
		it('avviser feil format', () => {
			expect(normalizeIsoDate('20.07.2026')).toBeNull();
			expect(normalizeIsoDate('')).toBeNull();
			expect(normalizeIsoDate(42)).toBeNull();
		});
	});

	describe('isContactDueForFollowUp', () => {
		const today = '2026-07-20';
		it('forfalt oppfølging + ikke ferdig = klar for purring', () => {
			expect(isContactDueForFollowUp({ status: 'todo', followUpAt: '2026-07-19' }, today)).toBe(true);
			expect(isContactDueForFollowUp({ status: 'venter', followUpAt: '2026-07-20' }, today)).toBe(true);
		});
		it('fremtidig oppfølging purres ikke', () => {
			expect(isContactDueForFollowUp({ status: 'todo', followUpAt: '2026-07-21' }, today)).toBe(false);
		});
		it('ferdig kontakt purres aldri', () => {
			expect(isContactDueForFollowUp({ status: 'ferdig', followUpAt: '2026-07-01' }, today)).toBe(false);
		});
		it('uten oppfølgingsdato purres ikke', () => {
			expect(isContactDueForFollowUp({ status: 'todo', followUpAt: null }, today)).toBe(false);
		});
	});

	describe('contactsDueForFollowUp', () => {
		it('plukker ut kun forfalte, ikke-ferdige', () => {
			const contacts = [
				{ id: 'a', status: 'todo' as const, followUpAt: '2026-07-10' },
				{ id: 'b', status: 'venter' as const, followUpAt: '2026-07-25' },
				{ id: 'c', status: 'ferdig' as const, followUpAt: '2026-07-01' },
				{ id: 'd', status: 'todo' as const, followUpAt: null }
			];
			const due = contactsDueForFollowUp(contacts, '2026-07-20');
			expect(due.map((c) => c.id)).toEqual(['a']);
		});
	});
});
